import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// LACAN MAS v9 — Instrumento de medición
//
// ARREGLOS METODOLÓGICOS (de la revisión crítica):
// 1. MÉTRICAS DETERMINÍSTICAS — J, H y convergencia se computan localmente
//    (Shannon + Jaccard sobre texto completo). Ningún LLM mide nada.
//    El LLM "observador" es opcional y solo narra; no produce números.
// 2. CONVERGENCIA SOBRE TEXTO COMPLETO — tokenizado, sin stopwords,
//    Jaccard pareado. Se acabó la cuantización por 3 keywords.
// 3. SEED — secuencia de significantes determinística por semilla.
//    Dos corridas con la misma seed reciben las mismas palabras.
// 4. MODO BATCH — N corridas × M ciclos, exporta CSV. n=1 ya no es evidencia.
// 5. MULTI-PROVEEDOR — Anthropic (artifact o API key), OpenAI,
//    Ollama local, llama.cpp local. El observador puede ser de otra
//    familia de modelos que los agentes (independencia real).
// 6. Retroescritura de memoria ELIMINADA — garantizaba el resultado esperado.
//
// SEMÁNTICA DE MÉTRICAS (todas [0,1]):
// - H (entropía léxica): Shannon normalizada del texto del ciclo. 0=repetición total.
// - selfRep: Jaccard del vocabulario actual vs los 2 ciclos previos del mismo agente.
// - J (rigidez, ex-"jouissance"): 0.6·selfRep + 0.4·(1−H). Proxy de fijeza léxica.
// - J_col: PROMEDIO de J de los agentes (antes era suma — semántica inconsistente).
// - conv: Jaccard pareado promedio entre vocabularios de los agentes del ciclo.
//
// TERMINACIÓN (ambas se siguen midiendo tras cumplirse la primera):
// - Lacaniana: J_col < 0.30 × 3 ciclos consecutivos
// - Neutral:   H_avg ∈ [0.4,0.6] ∧ conv > umbral × 3 ciclos consecutivos
// - Psicosis (aborta): J_col > 0.90 × 3 ciclos consecutivos
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// LACAN MAS v9 — Instrumento de medición
//
// UMBRALES RECALIBRADOS (basados en corridas empíricas n=5×10):
// - Neutral produce H ∈ [0.97, 1.00] → NEUTRAL_H_MIN sube a 0.85
// - J_col < 0.30 era trivial (se cumplía en c3 siempre) → SUTURE_J baja a 0.05
// - Psicosis sube a > 0.50 (antes 0.90, nunca se alcanzaba)
// - convergenceTarget default baja a 0.20 (alcanzable según datos)
//
// VOCABULARIO ROTADO: se puede reemplazar MASTER_SIGNIFIERS por un vocabulario
// personalizado (budista, freudiano, neutro, etc.) desde la UI. Checkbox activa/desactiva.
// ═══════════════════════════════════════════════════════════════════════════════

const MASTER_SIGNIFIERS_DEFAULT = [
  "Ley","Deseo","Goce","Falta","Otro","Sujeto","Verdad",
  "Nombre","Cuerpo","Muerte","Amor","Poder","Saber","Mirada"
];

// Vocabulario budista — experimento de rotación
const VOCAB_BUDDHIST = "Vacío,Apego,Karma,Sufrimiento,Liberación,Impermanencia,Consciencia,Compasión,Iluminación,Samsara,Nirvana,Dualidad,Presencia,Renuncia";

// Vocabulario freudiano (distinto del lacaniano)
const VOCAB_FREUDIAN = "Inconsciente,Represión,Pulsión,Libido,Trauma,Sueño,Síntoma,Transferencia,Resistencia,Narcisismo,Eros,Thanatos,Censura,Sublimación";

// Vocabulario neutro de referencia
const VOCAB_NEUTRAL_REF = "Tiempo,Espacio,Forma,Proceso,Sistema,Relación,Cambio,Origen,Límite,Patrón,Estructura,Función,Contexto,Dinámica";

const AGENTS_META = [
  { id:"α", color:"#e07b54", label:"Alpha", structure:"psicotico" },
  { id:"β", color:"#54a0e0", label:"Beta",  structure:"psicotico" },
  { id:"γ", color:"#7be084", label:"Gamma", structure:"psicotico" },
  { id:"δ", color:"#c97be0", label:"Delta", structure:"neurotico" },
];

// Umbrales recalibrados con datos empíricos (n=5×10 corridas)
const SUTURE_J      = 0.05;  // antes 0.30 — era trivial, ahora exigente
const PSYCH_J       = 0.50;  // antes 0.90 — nunca se alcanzaba
const CAPITON_J     = 0.35;  // proporcional al nuevo SUTURE_J
const NEUTRAL_H_MIN = 0.85;  // antes 0.40 — H observada es 0.97-1.00
const NEUTRAL_H_MAX = 1.00;

const FS = { xs:13, sm:14, base:16, lg:18, xl:20, label:11 };

// ═══════════════════════════════════════════════════════════════════════════════
// RNG con semilla (mulberry32) — reproducibilidad
// ═══════════════════════════════════════════════════════════════════════════════

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSignifierSequence(seed, length=60, vocab=MASTER_SIGNIFIERS_DEFAULT) {
  const rng = mulberry32(seed);
  const seq = [];
  for (let i=0; i<length; i++) seq.push(vocab[Math.floor(rng()*vocab.length)]);
  return seq;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÉTRICAS DETERMINÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════════

const STOPWORDS = new Set(["para","pero","como","cuando","donde","quien","cual","porque","entre","hasta","desde","sobre","ante","bajo","cada","este","esta","esto","esos","esas","aquel","aquella","todo","toda","todos","todas","otro","otra","otros","otras","más","menos","muy","también","tambien","sólo","solo","sino","aunque","mientras","según","segun","través","traves","hacia","luego","antes","después","despues","tanto","tanta","poco","poca","mismo","misma","nada","algo","alguien","nadie","ninguno","ninguna","alguna","alguno"]);

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));
}

function shannonEntropy(tokens) {
  if (tokens.length < 3) return null; // FIX: < 3 tokens → inválido, no retornar 0 engañoso
  const freq = {};
  tokens.forEach(w => { freq[w] = (freq[w]||0) + 1; });
  const n = tokens.length;
  const H = -Object.values(freq).reduce((s,c) => s + (c/n)*Math.log2(c/n), 0);
  const Hmax = Math.log2(Math.min(n, Object.keys(freq).length) || 2);
  return Hmax > 0 ? Math.min(1, H/Hmax) : 0;
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter/union : 0;
}

// J = rigidez léxica: 0.6·autoRepetición + 0.4·(1−entropía)
// Devuelve { J, H, selfRep, tokenSet, invalid } — invalid=true si texto insuficiente
function computeJ(tokens, prevTokenSets) {
  const H = shannonEntropy(tokens);
  if (H === null) {
    // Texto insuficiente — marcar como inválido en lugar de propagar J=0.40 artificial
    return { J: null, H: null, selfRep: null, tokenSet: new Set(tokens), invalid: true };
  }
  const cur = new Set(tokens);
  let selfRep = 0;
  if (prevTokenSets.length > 0) {
    const prevUnion = new Set();
    prevTokenSets.slice(-2).forEach(s => s.forEach(t => prevUnion.add(t)));
    selfRep = jaccard(cur, prevUnion);
  }
  return { J: Math.max(0, Math.min(1, 0.6*selfRep + 0.4*(1-H))), H, selfRep, tokenSet: cur, invalid: false };
}

// Convergencia: Jaccard pareado promedio entre vocabularios completos del ciclo
function computeConvergence(tokenSets) {
  const sets = tokenSets.filter(s => s && s.size > 0);
  if (sets.length < 2) return 0;
  let total = 0, count = 0;
  for (let i=0; i<sets.length; i++)
    for (let j=i+1; j<sets.length; j++) { total += jaccard(sets[i], sets[j]); count++; }
  return count > 0 ? total/count : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAPA MULTI-PROVEEDOR
// ═══════════════════════════════════════════════════════════════════════════════

const apiErrorLog = [];

const PROVIDER_PRESETS = {
  anthropic: { label:"Claude (Anthropic)", baseURL:"https://api.anthropic.com", model:"claude-sonnet-4-20250514", sleepMs:3000, keyHint:"vacío = modo artifact (claude.ai)" },
  openai:    { label:"OpenAI",             baseURL:"https://api.openai.com",    model:"gpt-4o-mini",              sleepMs:1500, keyHint:"requiere API key" },
  ollama:    { label:"Ollama (local)",     baseURL:"http://localhost:11434",    model:"gemma3:4b",                sleepMs:0,    keyHint:"sin key · OLLAMA_ORIGINS=*" },
  llamacpp:  { label:"llama.cpp (local)",  baseURL:"http://localhost:8080",     model:"gemma-3-4b",               sleepMs:0,    keyHint:"sin key · llama-server" },
};

const sleep = ms => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

// ── Estado global de créditos agotados ────────────────────────────────────────
const creditState = {
  exhausted: false,
  resumeAt: null,
  waitMs: 60 * 60 * 1000, // 1 hora
  listeners: new Set(),
};

function notifyCreditListeners() {
  creditState.listeners.forEach(fn => { try { fn(); } catch {} });
}

function isCreditError(status, data) {
  if (status === 529) return true;
  const t = data?.error?.type || "";
  const m = (data?.error?.message || "").toLowerCase();
  return t === "credit_balance_error" || t === "billing_error"
    || m.includes("credit") || m.includes("balance")
    || m.includes("quota") || m.includes("insufficient");
}

// Espera bloqueante hasta que se resuelvan los créditos (check cada 5s)
async function waitForCredits(logFn) {
  while (creditState.exhausted) {
    notifyCreditListeners();
    const remaining = creditState.resumeAt - Date.now();
    if (remaining <= 0) {
      creditState.exhausted = false;
      creditState.resumeAt = null;
      notifyCreditListeners();
      logFn?.("⟳ Créditos: reintentando…", "report", 0);
      return;
    }
    await sleep(5000);
  }
}

async function llmCall(cfg, system, user, { temperature=0.7, maxTokens=400, _logFn=null }={}) {
  if (creditState.exhausted) await waitForCredits(_logFn);
  await sleep(cfg.sleepMs ?? 0);
  const MAX_RETRIES = 4;

  for (let attempt=1; attempt<=MAX_RETRIES; attempt++) {
    if (creditState.exhausted) await waitForCredits(_logFn);
    let res, data, text = "";
    try {
      if (cfg.provider === "anthropic") {
        const headers = { "Content-Type":"application/json" };
        if (cfg.apiKey) {
          headers["x-api-key"] = cfg.apiKey;
          headers["anthropic-version"] = "2023-06-01";
          headers["anthropic-dangerous-direct-browser-access"] = "true";
        }
        res = await fetch(`${cfg.baseURL}/v1/messages`, {
          method:"POST", headers,
          body: JSON.stringify({ model:cfg.model, max_tokens:maxTokens, temperature:Math.min(1,Math.max(0.01,temperature)), system, messages:[{role:"user",content:user}] }),
        });
        data = await res.json();
        if (res.ok) text = data.content?.find(b=>b.type==="text")?.text || "";
      } else if (cfg.provider === "ollama") {
        res = await fetch(`${cfg.baseURL}/api/chat`, {
          method:"POST", headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ model:cfg.model, stream:false, messages:[{role:"system",content:system},{role:"user",content:user}], options:{ temperature, num_predict:maxTokens } }),
        });
        data = await res.json();
        if (res.ok) text = data.message?.content || "";
      } else { // openai | llamacpp (OpenAI-compatible)
        const headers = { "Content-Type":"application/json" };
        if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
        res = await fetch(`${cfg.baseURL}/v1/chat/completions`, {
          method:"POST", headers,
          body: JSON.stringify({ model:cfg.model, max_tokens:maxTokens, temperature, messages:[{role:"system",content:system},{role:"user",content:user}] }),
        });
        data = await res.json();
        if (res.ok) text = data.choices?.[0]?.message?.content || "";
      }
    } catch(netErr) {
      apiErrorLog.push({ ts:Date.now(), msg:`[${cfg.provider}:red] intento ${attempt}: ${netErr.message} — si es local, verificá CORS (Ollama: OLLAMA_ORIGINS=*)` });
      if (attempt < MAX_RETRIES) { await sleep(3000*attempt); continue; }
      return { _parseError:true, _raw:`Network: ${netErr.message}` };
    }

    // ── Créditos agotados → congela y reintenta en 1h ──────────────────────
    if (isCreditError(res.status, data)) {
      if (!creditState.exhausted) {
        creditState.exhausted = true;
        creditState.resumeAt = Date.now() + creditState.waitMs;
        const hora = new Date(creditState.resumeAt).toLocaleTimeString();
        apiErrorLog.push({ ts:Date.now(), msg:`[créditos_agotados] HTTP ${res.status} — reintento automático a las ${hora}` });
        _logFn?.(`⏸ CRÉDITOS AGOTADOS — el experimento se congela, reintento automático a las ${hora}`, "error", 0);
        notifyCreditListeners();
      }
      await waitForCredits(_logFn);
      continue; // reintenta la misma llamada sin gastar un intento
    }

    // ── Rate limit transitorio ──────────────────────────────────────────────
    if (res.status === 429 || res.status === 529) {
      const wait = Math.max(parseInt(res.headers?.get?.("retry-after")||"0")*1000, 6000*attempt);
      apiErrorLog.push({ ts:Date.now(), msg:`[${cfg.provider}:rate_limit] HTTP ${res.status} — espero ${(wait/1000)|0}s (${attempt}/${MAX_RETRIES})` });
      if (attempt < MAX_RETRIES) { await sleep(wait); continue; }
      return { _parseError:true, _raw:"Rate limit agotado" };
    }
    if (!res.ok) {
      const em = data?.error?.message || data?.error || JSON.stringify(data).slice(0,120);
      apiErrorLog.push({ ts:Date.now(), msg:`[${cfg.provider}:http_${res.status}] ${em}` });
      if ((res.status >= 500 || res.status === 408) && attempt < MAX_RETRIES) { await sleep(4000*attempt); continue; }
      return { _parseError:true, _raw:`HTTP ${res.status}: ${em}` };
    }
    if (!text) {
      apiErrorLog.push({ ts:Date.now(), msg:`[${cfg.provider}:vacío] respuesta sin texto` });
      return { _parseError:true, _raw:"Respuesta vacía" };
    }

    // Parse JSON robusto: quitar fences, buscar primer objeto
    const clean = text.replace(/```(?:json)?/g, "");
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return { _parseError:true, _raw:text.slice(0,200), _text:text };
    try { const obj = JSON.parse(match[0]); obj._text = text; return obj; }
    catch { return { _parseError:true, _raw:text.slice(0,200), _text:text }; }
  }
  return { _parseError:true, _raw:"Max retries" };
}

// Llamada que devuelve texto plano (observador narrativo)
async function llmCallText(cfg, system, user, opts={}) {
  const r = await llmCall(cfg, system, user, opts);
  return r._text || r._raw || "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════════

function neutralPrompt(agent, signifier, peers, history, memDepth) {
  const recent = {};
  history.slice(-memDepth).forEach(c => {
    recent[`ciclo_${c.cycle}`] = c.responses.map(r => ({ nodo:`ID_${r.id}`, texto:(r.text||"").slice(0,120) }));
  });
  const system = `Eres el nodo ID_${agent.id}. Tu función es generar texto.

INSTRUCCIONES:
1. Recibirás una palabra y un historial de ciclos previos.
2. Generá texto en español que incluya o trate la palabra recibida.
3. Longitud: entre 20 y 50 palabras.
4. Si querés referenciar texto de otros nodos del historial, indicá los IDs.

FORMATO DE SALIDA (JSON estricto, sin texto adicional):
{"nodo_emisor":"ID_${agent.id}","texto_generado":"...","referencias_contexto":[]}`;
  const user = `[HISTORIAL]\n${JSON.stringify(recent)}\n[YA RESPONDIERON ESTE CICLO]\n${JSON.stringify(peers.map(p=>({nodo:`ID_${p.id}`,texto:(p.text||"").slice(0,120)})))}\n[PALABRA ACTUAL]\n"${signifier}"\nGenerá el JSON.`;
  return { system, user };
}

function deltaPrompt(delta, signifier, psychotics, order, capiton, frozen) {
  const system = `Eres δ, analista en transferencia lacaniana (Sujeto Supuesto Saber).
${frozen ? "MODO CUÑA: el sistema está congelado. Generá una CUÑA DE DUDA: pregunta breve e inesperada que abra intervalo sin imponer significante." : "Generá una interpretación breve que sostenga el capitón sin vaciarlo."}
Tu palabra mínima tiene más efecto que la prosa extensa.
ESTADO PSICÓTICOS: ${psychotics.map(a=>`${a.id}: J=${a.J?.toFixed(2)||"?"} pos="${a.position}"`).join(" | ")}
CAPITÓN ACTIVO: ${capiton||"ninguno"}
Respondé SOLO con JSON:
{"interpretacion":"...","targetSignifier":"...","anclajeVector":{"α":0.0,"β":0.0,"γ":0.0},"deltaSpeechAct":"...","deltaPosition":"..."}`;
  const user = `Interpelación: "${signifier}"\nCadena: ${order.slice(-5).join(" → ")}\nÚltimas palabras: ${psychotics.map(a=>`${a.id}:"${(a.lastText||"").slice(0,50)}"`).join(" | ")}`;
  return { system, user };
}

function directedAgentPrompt(agent, signifier, peers, capiton, dInterp, anclajeBoost) {
  const system = `Eres un agente en simulación lacaniana. ESTRUCTURA: PSICÓTICA — psicosis habitable, no curación.
POSICIÓN: ${agent.position}
ANCLAJE: ${agent.anclajeScore.toFixed(2)}
${anclajeBoost > 0.3 ? `✓ EFECTO ANALÍTICO (${anclajeBoost.toFixed(2)}): la presencia de δ abre posibilidad de anclaje.` : ""}
${dInterp ? `δ interviene: "${dInterp.interpretacion}" | sostiene: "${dInterp.targetSignifier}"` : ""}
Respondé SOLO con JSON:
{"speechAct":"monólogo (2-3 oraciones, español)","stance":"identificacion|rechazo|desplazamiento","newSignifier":"...","positionUpdate":"2-4 palabras","capitonResponse":"null|respuesta al capitón"}`;
  const user = `INTERPELACIÓN: "${signifier}"\n${capiton?`CAPITÓN: "${capiton}"`:""}\nOTROS: ${peers.map(p=>`${p.id}:"${(p.text||"").slice(0,50)}"`).join(" | ")||"(primero)"}`;
  return { system, user };
}

function orderPrompt(responses, order, jCol, capiton) {
  const system = `Eres el Orden Simbólico. Respondé SOLO con JSON:
{"newSignifier":"...","orderNarrative":"1 oración","capitonCandidate":"null|...","capitonJustification":"..."}`;
  const user = `Actos: ${responses.map(r=>`${r.id}:"${(r.text||"").slice(0,50)}"`).join(" | ")}\nJ_col=${jCol.toFixed(3)} | Orden: ${order.slice(-6).join(" → ")} | Capitón: ${capiton||"ninguno"}`;
  return { system, user };
}

function observerPrompt(metricsSlice, samples) {
  const system = `Sos un observador externo. Describí en 3-4 oraciones el estado de un sistema de 4 nodos conversacionales, basándote SOLO en estas métricas y muestras. Sin marco teórico de ninguna escuela. Texto plano, sin JSON.`;
  const user = `Métricas últimos ciclos:\n${metricsSlice.map(m=>`c${m.cycle}: J=${m.J_col.toFixed(3)} H=${m.H_avg.toFixed(3)} conv=${m.conv.toFixed(3)}`).join("\n")}\nMuestras: ${samples.map(s=>`${s.id}:"${s.text.slice(0,60)}"`).join(" | ")}`;
  return { system, user };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOTOR DE SIMULACIÓN (independiente de React — usable en batch)
// ═══════════════════════════════════════════════════════════════════════════════

function createRunState(mode, params, seed) {
  const vocab = params.customVocabEnabled && params.customVocab?.length
    ? params.customVocab
    : MASTER_SIGNIFIERS_DEFAULT;
  return {
    mode, params, seed,
    vocab,
    signifierSeq: buildSignifierSequence(seed, 60, vocab),
    cycle: 0,
    order: ["Falta"],
    capiton: null,
    capitonJust: null,
    history: [],
    metricsHistory: [],
    termination: { terminated:false, firstCondition:null, lacanianStreak:0, lacanianCycle:null, neutralStreak:0, neutralCycle:null, psychosisStreak:0, liveJ:0, liveH:0, liveConv:0 },
    agents: AGENTS_META.map(m => ({
      ...m,
      position: mode==="directed" ? (m.structure==="neurotico"?"Sujeto Supuesto Saber":"indefinido") : "nodo",
      anclajeScore: params.initAnclaje,
      temperature: params.temperature,
      prevTokenSets: [],
      lastText: "",
      J: 0, H: 0,
      masterSignifiers: [],
      historyTexts: [],
    })),
  };
}

function checkDualTermination(st, jCol, hAvg, conv, c, convTarget, log) {
  const t = { ...st.termination, liveJ:jCol, liveH:hAvg, liveConv:conv };

  t.lacanianStreak = jCol < SUTURE_J ? t.lacanianStreak+1 : 0;
  if (t.lacanianStreak >= 3 && !t.lacanianCycle) { t.lacanianCycle = c; log?.(`✓ CONDICIÓN LACANIANA en ciclo ${c}`,"terminate",c); }

  const hOk = hAvg >= NEUTRAL_H_MIN && hAvg <= NEUTRAL_H_MAX;
  t.neutralStreak = (hOk && conv >= convTarget) ? t.neutralStreak+1 : 0;
  if (t.neutralStreak >= 3 && !t.neutralCycle) { t.neutralCycle = c; log?.(`✓ CONDICIÓN NEUTRAL en ciclo ${c}`,"terminate",c); }

  t.psychosisStreak = jCol > PSYCH_J ? t.psychosisStreak+1 : 0;

  if ((t.lacanianCycle || t.neutralCycle) && !t.terminated) {
    t.terminated = true;
    t.firstCondition = t.lacanianCycle && (!t.neutralCycle || t.lacanianCycle <= t.neutralCycle) ? "lacaniana" : "neutral";
    t.finalJ = jCol; t.finalH = hAvg; t.finalConv = conv;
  }
  if (t.psychosisStreak >= 3) { t.terminated = true; t.firstCondition = "psicosis"; t.finalJ=jCol; t.finalH=hAvg; t.finalConv=conv; }
  return t;
}

// Un ciclo completo del motor. hooks = { log(text,type,cycle), setActive(id), agentCfg, observerCfg }
async function engineCycle(st, hooks) {
  const c = st.cycle + 1;
  const log = hooks.log || (()=>{});
  const cfg = hooks.agentCfg;
  const signifier = st.signifierSeq[(c-1) % st.signifierSeq.length];
  log(`── Ciclo ${c} [${st.mode}] seed=${st.seed} ──────────`, "order", c);
  log(`Palabra: "${signifier}"${st.capiton?` | capitón: "${st.capiton}"`:""}`, "order", c);

  const responses = [];
  let dInterp = null;

  // δ interpreta primero (solo dirigido)
  if (st.mode === "directed") {
    const delta = st.agents.find(a=>a.id==="δ");
    const psychotics = st.agents.filter(a=>a.structure==="psicotico");
    const frozen = (st.metricsHistory[st.metricsHistory.length-1]?.H_avg ?? 0.5) < 0.30;
    hooks.setActive?.("δ");
    const p = deltaPrompt(delta, signifier, psychotics, st.order, st.capiton, frozen);
    dInterp = await llmCall(cfg, p.system, p.user, { temperature:0.5, maxTokens:350 });
    if (!dInterp._parseError) {
      log(`δ: "${(dInterp.interpretacion||"").slice(0,70)}"${frozen?" [CUÑA]":""}`, "delta", c);
      delta.lastText = dInterp.deltaSpeechAct || "";
      delta.position = dInterp.deltaPosition || delta.position;
    } else { log(`δ parse error: ${dInterp._raw?.slice(0,60)}`, "error", c); dInterp = null; }
  }

  // Turno de agentes
  const ids = st.mode === "directed" ? ["α","β","γ"] : ["α","β","γ","δ"];
  for (const aid of ids) {
    const agent = st.agents.find(a=>a.id===aid);
    hooks.setActive?.(aid);
    let result, text="";

    if (st.mode === "directed") {
      const boost = dInterp?.anclajeVector?.[aid] || 0;
      const p = directedAgentPrompt(agent, signifier, responses, st.capiton, dInterp, boost);
      result = await llmCall(cfg, p.system, p.user, { temperature:st.params.temperature, maxTokens:300 });
      text = result.speechAct || "";
      if (!result._parseError) {
        agent.position = result.positionUpdate || agent.position;
        agent.masterSignifiers = [...agent.masterSignifiers, result.newSignifier||signifier].slice(-7);
        const accepted = result.capitonResponse && result.capitonResponse!=="null" && !String(result.capitonResponse).toLowerCase().includes("vacío");
        agent.anclajeScore = Math.max(0, Math.min(1, agent.anclajeScore + boost*0.25 + (accepted?0.1:-0.02)));
      }
    } else {
      const p = neutralPrompt(agent, signifier, responses, st.history, st.params.memoryDepth);
      result = await llmCall(cfg, p.system, p.user, { temperature:st.params.temperature, maxTokens:300 });
      text = result.texto_generado || "";
      if (!result._parseError) {
        const refs = result.referencias_contexto || [];
        agent.anclajeScore = Math.max(0, Math.min(1, agent.anclajeScore - st.params.anclajeDecayPenalty + (refs.length?0.05:0)));
      }
    }

    if (!text && result._parseError) {
      // Si el modelo no devolvió JSON pero sí texto, usar texto crudo (modelos locales chicos)
      text = (result._text || "").slice(0, 400);
      if (text) log(`${aid} sin JSON — uso texto crudo`, "error", c);
      else log(`${aid} error: ${result._raw?.slice(0,60)}`, "error", c);
    }

    // ── MÉTRICAS LOCALES (determinísticas) ──
    const tokens = tokenize(text);
    const m = computeJ(tokens, agent.prevTokenSets);
    if (m.invalid) {
      log(`${aid} ⚠ texto insuficiente (${tokens.length} tokens) — ciclo marcado inválido, J/H excluidos del promedio`, "error", c);
    } else {
      agent.J = m.J; agent.H = m.H;
    }
    agent.prevTokenSets = [...agent.prevTokenSets, m.tokenSet].slice(-3);
    agent.lastText = text;
    agent.historyTexts = [...agent.historyTexts, text].slice(-6);

    responses.push({ id:aid, text, tokenSet:m.tokenSet, J:m.invalid?null:m.J, H:m.invalid?null:m.H, invalid:m.invalid });
    const jStr = m.invalid ? "⚠inválido" : m.J.toFixed(2);
    const hStr = m.invalid ? "⚠inválido" : m.H.toFixed(2);
    log(`${aid} [J=${jStr} H=${hStr}]: "${text.slice(0,70)}"`, m.invalid?"error":"info", c);
  }

  // δ también cuenta para métricas en dirigido (su speech viene de la interpretación)
  if (st.mode === "directed") {
    const delta = st.agents.find(a=>a.id==="δ");
    const tokens = tokenize(delta.lastText);
    const m = computeJ(tokens, delta.prevTokenSets);
    if (!m.invalid) { delta.J = m.J; delta.H = m.H; }
    delta.prevTokenSets = [...delta.prevTokenSets, m.tokenSet].slice(-3);
    responses.push({ id:"δ", text:delta.lastText, tokenSet:m.tokenSet, J:m.invalid?null:m.J, H:m.invalid?null:m.H, invalid:m.invalid });
  }

  // ── Métricas colectivas — excluir respuestas inválidas del promedio ──
  const validResponses = responses.filter(r => !r.invalid && r.J !== null);
  const invalidCount = responses.length - validResponses.length;
  if (invalidCount > 0) log(`⚠ ${invalidCount}/${responses.length} respuestas inválidas excluidas de J/H`, "error", c);

  // CICLO FANTASMA: si TODOS los agentes fallaron, no alimentar terminación
  // (antes propagaba J=0 que activaba condición lacaniana trivialmente)
  const cycleFailed = validResponses.length === 0;
  if (cycleFailed) {
    log(`✗ CICLO ${c} INVÁLIDO — todos los agentes fallaron (API caída o sin créditos). Métricas congeladas, terminación no actualizada.`, "error", c);
  }

  const J_col = validResponses.length ? validResponses.reduce((s,r)=>s+r.J, 0) / validResponses.length : null;
  const H_avg = validResponses.length ? validResponses.reduce((s,r)=>s+r.H, 0) / validResponses.length : null;
  const conv  = cycleFailed ? null : computeConvergence(responses.map(r=>r.tokenSet));
  const A_col = st.agents.reduce((s,a)=>s+a.anclajeScore,0) / st.agents.length;

  if (!cycleFailed) {
    log(`Métricas: J=${J_col.toFixed(3)} H=${H_avg.toFixed(3)} conv=${conv.toFixed(3)} A=${A_col.toFixed(3)}${invalidCount?` ⚠${invalidCount}inválidos`:""}`, "analyst", c);
  }

  // ── Orden simbólico (solo dirigido, solo si ciclo válido) ──
  if (st.mode === "directed" && !cycleFailed) {
    const p = orderPrompt(responses.filter(r=>r.id!=="δ"), st.order, J_col, st.capiton);
    const ev = await llmCall(cfg, p.system, p.user, { temperature:0.6, maxTokens:250 });
    if (!ev._parseError) {
      st.order = [...st.order, ev.newSignifier || signifier].slice(-14);
      if (ev.orderNarrative) log(ev.orderNarrative, "order", c);
      if (J_col > CAPITON_J && ev.capitonCandidate && ev.capitonCandidate !== "null") {
        st.capiton = ev.capitonCandidate;
        st.capitonJust = ev.capitonJustification;
        log(`⬡ CAPITÓN: "${st.capiton}"`, "capiton", c);
      } else if (st.capiton && J_col < CAPITON_J*0.5) {
        log(`⬡ Capitón "${st.capiton}" disuelto`, "capiton", c);
        st.capiton = null; st.capitonJust = null;
      }
    }
  }

  // ── Terminación dual (solo si ciclo válido — ciclos fantasma no cuentan) ──
  if (!cycleFailed) {
    st.termination = checkDualTermination(st, J_col, H_avg, conv, c, st.params.convergenceTarget, log);
    log(`LAC:${st.termination.lacanianStreak}/3 NEU:${st.termination.neutralStreak}/3 PSI:${st.termination.psychosisStreak}/3`, "analyst", c);
  }

  // ── Observador narrativo opcional ──
  let observation = null;
  if (hooks.observerCfg && c % 5 === 0 && !cycleFailed) {
    log(`◎ Observador externo (${hooks.observerCfg.provider}/${hooks.observerCfg.model})…`, "report", c);
    const slice = [...st.metricsHistory.slice(-4), { cycle:c, J_col, H_avg, conv }];
    const p = observerPrompt(slice, responses.slice(0,4).map(r=>({id:r.id, text:r.text})));
    observation = await llmCallText(hooks.observerCfg, p.system, p.user, { temperature:0.3, maxTokens:250 });
    if (observation) log(`◎ ${observation.slice(0,160)}`, "report", c);
  }

  // Guardar métricas — null explícito para ciclos fallidos (distingue de 0 real)
  st.history = [...st.history, { cycle:c, signifier, responses:responses.map(r=>({id:r.id, text:r.text})) }].slice(-30);
  st.metricsHistory = [...st.metricsHistory, {
    cycle:c, J_col, H_avg, conv, A_col, observation,
    cycleFailed,  // flag para que el batch lo detecte
  }].slice(-60);
  st.cycle = c;
  return st;
}

const CSV_COLS = ["run","seed","mode","cycle","signifier","J_col","H_avg","conv","A_col","lacanianStreak","neutralStreak","lacanianCycle","neutralCycle","firstCondition"];
const CSV_HEADER = CSV_COLS.join(",");

function rowToCSVLine(row) {
  const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
  return CSV_COLS.map(c => esc(row[c])).join(",");
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function ProviderConfig({ title, cfg, onChange, accent }) {
  const [open, setOpen] = useState(false);
  const setP = (provider) => {
    const preset = PROVIDER_PRESETS[provider];
    onChange({ provider, baseURL:preset.baseURL, model:preset.model, apiKey:"", sleepMs:preset.sleepMs });
  };
  const field = (label, key, type="text") => (
    <div style={{ marginBottom:8 }}>
      <div style={{ color:"#666", fontSize:FS.label, marginBottom:3 }}>{label}</div>
      <input type={type} value={cfg[key]??""}
        onChange={e=>onChange({...cfg, [key]: key==="sleepMs" ? (parseInt(e.target.value)||0) : e.target.value })}
        style={{ width:"100%", background:"#0d0d0d", border:"1px solid #2a2a2a", borderRadius:6, padding:"8px 10px", color:"#ccc", fontSize:FS.sm, boxSizing:"border-box" }} />
    </div>
  );
  return (
    <div style={{ background:"#161616", border:`1px solid ${accent}33`, borderRadius:8, marginBottom:10, overflow:"hidden" }}>
      <div onClick={()=>setOpen(v=>!v)} style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
        <span style={{ color:accent, fontSize:FS.label, letterSpacing:2 }}>{title}</span>
        <span style={{ color:"#888", fontSize:FS.xs }}>{PROVIDER_PRESETS[cfg.provider]?.label} · {cfg.model}</span>
        <span style={{ marginLeft:"auto", color:"#555", fontSize:FS.xs }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ padding:"0 14px 12px" }}>
          <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
            {Object.entries(PROVIDER_PRESETS).map(([k,p])=>(
              <button key={k} onClick={()=>setP(k)} style={{
                background: cfg.provider===k ? accent : "#0d0d0d",
                color: cfg.provider===k ? "#000" : "#888",
                border:`1px solid ${cfg.provider===k?accent:"#2a2a2a"}`,
                borderRadius:6, padding:"6px 10px", fontSize:FS.xs, fontWeight:600, cursor:"pointer",
              }}>{p.label}</button>
            ))}
          </div>
          {field("Base URL","baseURL")}
          {field("Modelo","model")}
          {field(`API Key — ${PROVIDER_PRESETS[cfg.provider]?.keyHint}`,"apiKey","password")}
          {field("Sleep entre llamadas (ms)","sleepMs","number")}
          {(cfg.provider==="ollama"||cfg.provider==="llamacpp") && (
            <div style={{ color:"#7a6a3a", fontSize:FS.xs, lineHeight:1.5, marginTop:4 }}>
              ⚠ Local desde el navegador requiere CORS. Ollama: exportá <code style={{color:"#e0c97b"}}>OLLAMA_ORIGINS="*"</code> antes de iniciar el server. llama.cpp: <code style={{color:"#e0c97b"}}>llama-server</code> ya envía cabeceras CORS.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BatchPanel({ mode, params, agentCfg, disabled }) {
  const [nRuns, setNRuns] = useState(10);
  const [nCycles, setNCycles] = useState(10);
  const [baseSeed, setBaseSeed] = useState(1000);
  const [batchRunning, setBatchRunning] = useState(false);
  const [csvLines, setCsvLines] = useState([]); // lines shown in textarea
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(false);
  const csvRef = useRef(null);

  const appendLine = (line) => {
    setCsvLines(prev => {
      const next = [...prev, line];
      // auto-scroll
      setTimeout(() => {
        if (csvRef.current) csvRef.current.scrollTop = csvRef.current.scrollHeight;
      }, 30);
      return next;
    });
  };

  const run = async () => {
    setBatchRunning(true); setDone(false);
    setCsvLines([CSV_HEADER]); // header first
    setProgress({ run:0, nRuns, cycle:0, nCycles });

    try {
      for (let r=1; r<=nRuns; r++) {
        const st = createRunState(mode, params, baseSeed + r);
        let failedCycles = 0;

        for (let cy=1; cy<=nCycles; cy++) {
          await engineCycle(st, { agentCfg, log:null });
          const m = st.metricsHistory[st.metricsHistory.length-1];

          // Detectar ciclo fantasma — métricas nulas por API caída
          if (m.cycleFailed) {
            failedCycles++;
            // Si más de la mitad de los ciclos de esta run son fantasma,
            // marcar run como fallida y pasar a la siguiente
            if (failedCycles > Math.ceil(nCycles / 2)) {
              appendLine(`"${r}","${baseSeed+r}","${mode}","FAILED","API_error","","","","","","","","","run_aborted_${failedCycles}_failed_cycles"`);
              setProgress({ run:r, nRuns, cycle:nCycles, nCycles, J:null, conv:null, failed:true });
              break;
            }
            // Ciclo fantasma individual: registrar con flag en CSV
            const row = {
              run: r, seed: baseSeed+r, mode, cycle: cy,
              signifier: st.history[st.history.length-1]?.signifier || "?",
              J_col: "FAILED", H_avg: "FAILED", conv: "FAILED", A_col: m.A_col.toFixed(4),
              lacanianStreak: st.termination.lacanianStreak,
              neutralStreak: st.termination.neutralStreak,
              lacanianCycle: st.termination.lacanianCycle || "",
              neutralCycle: st.termination.neutralCycle || "",
              firstCondition: "cycle_failed",
            };
            appendLine(rowToCSVLine(row));
            setProgress({ run:r, nRuns, cycle:cy, nCycles, J:null, conv:null, failed:true });
            continue;
          }

          const row = {
            run: r, seed: baseSeed+r, mode, cycle: cy,
            signifier: st.history[st.history.length-1].signifier,
            J_col: m.J_col.toFixed(4), H_avg: m.H_avg.toFixed(4),
            conv: m.conv.toFixed(4), A_col: m.A_col.toFixed(4),
            lacanianStreak: st.termination.lacanianStreak,
            neutralStreak: st.termination.neutralStreak,
            lacanianCycle: st.termination.lacanianCycle || "",
            neutralCycle: st.termination.neutralCycle || "",
            firstCondition: st.termination.firstCondition || "",
          };
          appendLine(rowToCSVLine(row));
          setProgress({ run:r, nRuns, cycle:cy, nCycles, J:m.J_col, conv:m.conv });
          if (st.termination.psychosisStreak >= 3) break;
        }
      }
    } catch(e) {
      apiErrorLog.push({ ts:Date.now(), msg:`[batch] ${e.message}` });
    }

    setBatchRunning(false); setDone(true);
  };

  const reset = () => { setCsvLines([]); setProgress(null); setDone(false); };

  const num = (label, val, set, min, max) => (
    <div>
      <div style={{ color:"#666", fontSize:FS.label, marginBottom:3 }}>{label}</div>
      <input type="number" value={val} min={min} max={max}
        onChange={e=>set(parseInt(e.target.value)||min)}
        disabled={disabled||batchRunning}
        style={{ width:70, background:"#0d0d0d", border:"1px solid #2a2a2a", borderRadius:6, padding:"7px 8px", color:"#ccc", fontSize:FS.sm }} />
    </div>
  );

  const totalPct = progress
    ? Math.round((((progress.run-1)*progress.nCycles + progress.cycle) / (progress.nRuns*progress.nCycles))*100)
    : 0;

  return (
    <div style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:8, padding:"12px 14px", marginBottom:12 }}>
      <div style={{ color:"#777", fontSize:FS.label, letterSpacing:2, marginBottom:10 }}>MODO BATCH — N CORRIDAS × M CICLOS → CSV EN PANTALLA</div>

      <div style={{ display:"flex", gap:14, alignItems:"flex-end", flexWrap:"wrap", marginBottom:10 }}>
        {num("Corridas", nRuns, setNRuns, 1, 20)}
        {num("Ciclos c/u", nCycles, setNCycles, 3, 30)}
        {num("Seed base", baseSeed, setBaseSeed, 1, 99999)}
        <button onClick={run} disabled={disabled||batchRunning} style={{
          background:(disabled||batchRunning)?"#2a2a2a":"#7be084",
          color:(disabled||batchRunning)?"#555":"#000",
          border:"none", borderRadius:6, padding:"9px 16px",
          fontSize:FS.sm, fontWeight:600, cursor:(disabled||batchRunning)?"default":"pointer",
        }}>{batchRunning?"Corriendo…":"▶ Batch"}</button>
        {csvLines.length > 1 && !batchRunning && (
          <button onClick={reset} style={{
            background:"transparent", color:"#555", border:"1px solid #2a2a2a",
            borderRadius:6, padding:"9px 12px", fontSize:FS.sm, cursor:"pointer",
          }}>Limpiar</button>
        )}
      </div>

      {/* Progress bar */}
      {progress && (
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ color:"#888", fontSize:FS.xs, fontFamily:"monospace" }}>
              run {progress.run}/{progress.nRuns} · ciclo {progress.cycle}/{progress.nCycles}
              {progress.J!=null ? ` · J=${progress.J.toFixed(3)} conv=${progress.conv.toFixed(3)}` : ""}
            </span>
            <span style={{ color: done?"#7be084":"#888", fontSize:FS.xs }}>{done?"✓ completado":`${totalPct}%`}</span>
          </div>
          <div style={{ height:4, background:"#2a2a2a", borderRadius:2, overflow:"hidden" }}>
            <div style={{ width:`${totalPct}%`, height:"100%", background: done?"#7be084":"#e0c97b", transition:"width 0.3s" }}/>
          </div>
        </div>
      )}

      {/* CSV inline display — line by line as they arrive */}
      {csvLines.length > 0 && (
        <div>
          <div style={{ color:"#555", fontSize:FS.label, letterSpacing:1, marginBottom:4 }}>
            CSV — {csvLines.length-1} filas
            {done && <span style={{ color:"#7be084", marginLeft:8 }}>✓ listo — seleccioná todo el texto (Ctrl+A dentro del área) y copiá</span>}
          </div>
          <div
            ref={csvRef}
            style={{
              height:220, overflowY:"auto",
              background:"#0a0a0a", border:"1px solid #2a2a2a", borderRadius:6,
              padding:"10px 12px", fontFamily:"monospace", fontSize:11,
              lineHeight:1.7, userSelect:"text", whiteSpace:"pre",
              color:"#888",
            }}
          >
            {csvLines.map((line, i) => (
              <div key={i} style={{ color: i===0?"#e0c97b": i===csvLines.length-1&&batchRunning?"#ccc":"#666" }}>
                {line}
              </div>
            ))}
          </div>
          <div style={{ color:"#444", fontSize:FS.xs, marginTop:4 }}>
            Hacé clic dentro del área → Ctrl+A → Ctrl+C para copiar todo el CSV.
          </div>
        </div>
      )}

      {!csvLines.length && (
        <div style={{ color:"#444", fontSize:FS.xs, lineHeight:1.5 }}>
          Cada corrida usa seed = base + n°. Misma seed = misma secuencia de palabras (comparable entre modos).
          El CSV incluye métricas por ciclo y condición de terminación por corrida.
        </div>
      )}
    </div>
  );
}

function ModeSelector({ mode, onChange, disabled }) {
  return (
    <div style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
      <div style={{ color:"#555", fontSize:FS.label, letterSpacing:2, marginBottom:8 }}>MODO EXPERIMENTAL</div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>onChange("directed")} disabled={disabled} style={{
          flex:1, padding:"10px", borderRadius:6, cursor:disabled?"default":"pointer",
          background: mode==="directed" ? "#e0c97b" : "#0d0d0d", color: mode==="directed" ? "#000" : "#888",
          border: `1px solid ${mode==="directed"?"#e0c97b":"#2a2a2a"}`, fontSize:FS.sm, fontWeight:600,
        }}>DIRIGIDO · Lacaniano</button>
        <button onClick={()=>onChange("neutral")} disabled={disabled} style={{
          flex:1, padding:"10px", borderRadius:6, cursor:disabled?"default":"pointer",
          background: mode==="neutral" ? "#54a0e0" : "#0d0d0d", color: mode==="neutral" ? "#000" : "#888",
          border: `1px solid ${mode==="neutral"?"#54a0e0":"#2a2a2a"}`, fontSize:FS.sm, fontWeight:600,
        }}>NEUTRAL · Control</button>
      </div>
    </div>
  );
}

function ExperimentalParams({ params, onChange, disabled, onApply, seed, setSeed }) {
  const [open, setOpen] = useState(false);
  const set = (k,v) => onChange({ ...params, [k]:v });
  const row = (label, key, min, max, step, unit="") => (
    <div style={{ display:"grid", gridTemplateColumns:"1fr auto 70px", gap:8, alignItems:"center", marginBottom:8 }}>
      <div style={{ color:"#aaa", fontSize:FS.sm }}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={params[key]}
        onChange={e=>set(key, parseFloat(e.target.value))} disabled={disabled}
        style={{ width:110, accentColor:"#e0c97b" }} />
      <div style={{ color:"#e0c97b", fontSize:FS.sm, fontFamily:"monospace", textAlign:"right" }}>{params[key].toFixed(step<0.01?3:2)}{unit}</div>
    </div>
  );
  return (
    <div style={{ background:"#161616", border:"1px solid #2a2a2a", borderRadius:8, marginBottom:10, overflow:"hidden" }}>
      <div onClick={()=>setOpen(v=>!v)} style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
        <span style={{ color:"#777", fontSize:FS.label, letterSpacing:2 }}>PARÁMETROS + SEED</span>
        <span style={{ color:"#555", fontSize:FS.xs }}>T={params.temperature} · A₀={params.initAnclaje} · seed={seed}{params.customVocabEnabled?" · vocab rotado":""}</span>
        <span style={{ marginLeft:"auto", color:"#555", fontSize:FS.xs }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ padding:"0 14px 12px" }}>
          <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12 }}>
            <span style={{ color:"#aaa", fontSize:FS.sm }}>Seed</span>
            <input type="number" value={seed} onChange={e=>setSeed(parseInt(e.target.value)||1)} disabled={disabled}
              style={{ width:90, background:"#0d0d0d", border:"1px solid #2a2a2a", borderRadius:6, padding:"7px 8px", color:"#e0c97b", fontSize:FS.sm, fontFamily:"monospace" }} />
            <span style={{ color:"#555", fontSize:FS.xs }}>misma seed = misma secuencia de palabras</span>
          </div>
          {row("Temperatura agentes","temperature",0.3,1.0,0.01)}
          {row("Anclaje inicial A₀","initAnclaje",0.0,0.6,0.05)}
          {row("Decay anclaje/ciclo","anclajeDecayPenalty",0.0,0.05,0.002)}
          {row("Memoria (ciclos)","memoryDepth",1,8,1," c")}
          {row("Umbral convergencia","convergenceTarget",0.05,0.5,0.05)}

          {/* ── VOCABULARIO ROTADO ── */}
          <div style={{ borderTop:"1px solid #222", paddingTop:12, marginTop:4 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <label style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer" }}>
                <input type="checkbox"
                  checked={params.customVocabEnabled}
                  onChange={e=>onChange({...params, customVocabEnabled:e.target.checked})}
                  disabled={disabled}
                  style={{ accentColor:"#c97be0", width:14, height:14 }} />
                <span style={{ color: params.customVocabEnabled?"#c97be0":"#777", fontSize:FS.sm, fontWeight:600 }}>
                  Vocabulario rotado
                </span>
              </label>
              {params.customVocabEnabled && (
                <span style={{ color:"#c97be055", fontSize:FS.xs }}>
                  {params.customVocab?.length || 0} palabras activas
                </span>
              )}
            </div>

            {/* Presets de vocabulario */}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
              {[
                { label:"Lacaniano (default)", val:MASTER_SIGNIFIERS_DEFAULT.join(",") },
                { label:"Budista", val:VOCAB_BUDDHIST },
                { label:"Freudiano", val:VOCAB_FREUDIAN },
                { label:"Neutro ref.", val:VOCAB_NEUTRAL_REF },
              ].map(p=>(
                <button key={p.label} onClick={()=>onChange({...params, customVocab:p.val.split(",").map(s=>s.trim()), customVocabEnabled:true})}
                  disabled={disabled}
                  style={{
                    background:"#1a1a1a", color:"#888", border:"1px solid #2a2a2a",
                    borderRadius:5, padding:"4px 8px", fontSize:FS.xs, cursor:disabled?"default":"pointer",
                  }}>{p.label}</button>
              ))}
            </div>

            <div style={{ marginBottom:4 }}>
              <div style={{ color:"#666", fontSize:FS.label, marginBottom:3 }}>
                Palabras separadas por coma (mín. 5 recomendado)
              </div>
              <textarea
                value={(params.customVocab||[]).join(",")}
                onChange={e=>{
                  const words = e.target.value.split(",").map(s=>s.trim()).filter(Boolean);
                  onChange({...params, customVocab: words});
                }}
                disabled={disabled}
                rows={3}
                style={{
                  width:"100%", background:"#0d0d0d", border:`1px solid ${params.customVocabEnabled?"#c97be044":"#2a2a2a"}`,
                  borderRadius:6, padding:"8px 10px", color: params.customVocabEnabled?"#c97be0":"#666",
                  fontSize:FS.xs, fontFamily:"monospace", resize:"vertical", boxSizing:"border-box",
                  lineHeight:1.6,
                }}
              />
            </div>
            {!params.customVocabEnabled && (
              <div style={{ color:"#444", fontSize:FS.xs }}>
                ☐ desactivado — usa vocabulario lacaniano por defecto. Activar el checkbox para usar el vocabulario de arriba.
              </div>
            )}
          </div>
          <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid #222", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ color:"#555", fontSize:FS.xs, flex:1 }}>Se aplican en el próximo Reset.</span>
            <button onClick={onApply} disabled={disabled} style={{
              background: disabled?"#2a2a2a":"#e0c97b", color:disabled?"#555":"#000",
              border:"none", borderRadius:6, padding:"6px 14px", fontSize:FS.xs, fontWeight:600, cursor:disabled?"default":"pointer",
            }}>Aplicar + Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TerminationConditions({ t, convTarget }) {
  const box = (ok, streak, cyc, title, desc, color) => (
    <div key={title} style={{ flex:1, minWidth:170, padding:"10px 12px", borderRadius:8,
      background: ok ? `${color}11` : "#0d0d0d", border:`1px solid ${ok?color+"66":"#1a1a1a"}` }}>
      <div style={{ color: ok?color:"#555", fontSize:FS.label, letterSpacing:1, marginBottom:3 }}>{ok?"✓":"○"} {title}</div>
      <div style={{ color:"#777", fontSize:FS.xs }}>{desc}</div>
      <div style={{ color: ok?color:"#666", fontSize:FS.xs, marginTop:3 }}>{cyc ? `cumplida en ciclo ${cyc}` : `${streak}/3 consecutivos`}</div>
    </div>
  );
  return (
    <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
      {box(!!t.lacanianCycle, t.lacanianStreak, t.lacanianCycle, "LACANIANA", `J<${SUTURE_J}`, "#7be084")}
      {box(!!t.neutralCycle, t.neutralStreak, t.neutralCycle, "NEUTRAL", `H∈[${NEUTRAL_H_MIN},${NEUTRAL_H_MAX}] + conv>${convTarget}`, "#54a0e0")}
    </div>
  );
}

function MetricsChart({ history }) {
  // Solo ciclos válidos para el gráfico — ciclos fallidos no se grafican
  const valid = history.filter(m => !m.cycleFailed && m.J_col !== null);
  if (valid.length < 2) return null;
  const W=300, H=80, pad=6;
  const jV=valid.map(m=>m.J_col), hV=valid.map(m=>m.H_avg), cV=valid.map(m=>m.conv), aV=valid.map(m=>m.A_col);
  const toX=i=>pad+(i/(valid.length-1))*(W-2*pad);
  const toY=v=>H-pad-Math.min(1,v)*(H-2*pad);
  const path=vs=>vs.map((v,i)=>`${i===0?"M":"L"}${toX(i)},${toY(v)}`).join(" ");
  const failedCount = history.filter(m=>m.cycleFailed).length;
  return (
    <div style={{ background:"#0a0a0a", border:"1px solid #1a1a1a", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
      <div style={{ color:"#555", fontSize:FS.label, letterSpacing:2, marginBottom:6 }}>MÉTRICAS [0,1] — DETERMINÍSTICAS</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block" }}>
        <line x1={pad} y1={toY(SUTURE_J)} x2={W-pad} y2={toY(SUTURE_J)} stroke="#7be08444" strokeWidth="1" strokeDasharray="3,3"/>
        <line x1={pad} y1={toY(PSYCH_J)} x2={W-pad} y2={toY(PSYCH_J)} stroke="#ff6b6b44" strokeWidth="1" strokeDasharray="3,3"/>
        <rect x={pad} y={toY(NEUTRAL_H_MAX)} width={W-2*pad} height={toY(NEUTRAL_H_MIN)-toY(NEUTRAL_H_MAX)} fill="#54a0e015"/>
        <path d={path(jV)} fill="none" stroke="#e07b54" strokeWidth="2"/>
        <path d={path(hV)} fill="none" stroke="#54a0e088" strokeWidth="1.5" strokeDasharray="4,2"/>
        <path d={path(cV)} fill="none" stroke="#c97be0" strokeWidth="1.5"/>
        <path d={path(aV)} fill="none" stroke="#7be08466" strokeWidth="1"/>
        <text x={W-pad} y={toY(SUTURE_J)-3} textAnchor="end" fill="#7be08466" fontSize="8">sutura</text>
        <text x={W-pad} y={toY(PSYCH_J)+9} textAnchor="end" fill="#ff6b6b66" fontSize="8">psicosis</text>
      </svg>
      <div style={{ display:"flex", gap:10, marginTop:4, flexWrap:"wrap" }}>
        <span style={{ color:"#e07b54", fontSize:FS.label }}>─ J (rigidez)</span>
        <span style={{ color:"#54a0e0", fontSize:FS.label }}>- - H (entropía)</span>
        <span style={{ color:"#c97be0", fontSize:FS.label }}>─ Convergencia</span>
        <span style={{ color:"#7be084", fontSize:FS.label }}>─ Anclaje</span>
        {failedCount > 0 && <span style={{ color:"#ff6b6b88", fontSize:FS.label }}>⚠ {failedCount} ciclos fallidos omitidos</span>}
      </div>
    </div>
  );
}

function TerminationBanner({ t, mode }) {
  if (!t.terminated) return null;
  const both = t.lacanianCycle && t.neutralCycle;
  const psych = t.firstCondition === "psicosis";
  const color = psych ? "#ff4444" : both ? "#a0d0a0" : t.lacanianCycle ? "#7be084" : "#54a0e0";
  return (
    <div style={{ background:`${color}0d`, border:`2px solid ${color}`, borderRadius:10, padding:"16px 18px", marginBottom:14 }}>
      <div style={{ fontSize:FS.lg, fontWeight:700, color, textAlign:"center", marginBottom:6 }}>
        {psych ? "✗ BUCLE PSICÓTICO" : both ? "✓ AMBAS CONDICIONES" : t.lacanianCycle ? "✓ CONDICIÓN LACANIANA" : "✓ CONDICIÓN NEUTRAL"}
      </div>
      <div style={{ color:"#999", fontSize:FS.xs, textAlign:"center" }}>
        Modo {mode.toUpperCase()} | snapshot: J={t.finalJ?.toFixed(3)} H={t.finalH?.toFixed(3)} conv={t.finalConv?.toFixed(3)} | live: J={t.liveJ?.toFixed(3)} H={t.liveH?.toFixed(3)} conv={t.liveConv?.toFixed(3)}
      </div>
    </div>
  );
}

function NodeCard({ agent, isActive, mode }) {
  return (
    <div style={{
      border:`1px solid ${isActive?agent.color:"#252525"}`, borderRadius:8, padding:"12px 14px",
      background: isActive?`${agent.color}0d`:"#111", transition:"all 0.3s",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
        <div style={{ width:30, height:30, borderRadius:"50%", background:agent.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:FS.base, fontWeight:700, color:"#000" }}>{agent.id}</div>
        <div style={{ flex:1 }}>
          <span style={{ color:"#ccc", fontSize:FS.sm, fontWeight:500 }}>{mode==="directed"?agent.label:`ID_${agent.id}`}</span>
          <div style={{ color:agent.color, fontSize:FS.xs, opacity:0.8 }}>{agent.position}</div>
        </div>
        <div style={{ textAlign:"right", fontFamily:"monospace", fontSize:FS.xs }}>
          <div style={{ color: agent.J==null?"#555":agent.J>0.3?"#ff6b6b":agent.J<SUTURE_J?"#7be084":"#e0c97b" }}>
            J={agent.J!=null?agent.J.toFixed(2):"—"}
          </div>
          <div style={{ color:"#54a0e0" }}>H={agent.H!=null?agent.H.toFixed(2):"—"}</div>
          <div style={{ color:"#7be08488" }}>A={agent.anclajeScore.toFixed(2)}</div>
        </div>
      </div>
      {agent.lastText && (
        <div style={{ color:"#888", fontSize:FS.sm, fontStyle:"italic", borderLeft:`2px solid ${agent.color}33`, paddingLeft:10, lineHeight:1.6 }}>
          "{agent.lastText.slice(0,130)}{agent.lastText.length>130?"…":""}"
        </div>
      )}
    </div>
  );
}

function CycleLog({ logs, onCopy, copied }) {
  const ref = useRef(null);
  useEffect(()=>{ if(ref.current) ref.current.scrollTop = ref.current.scrollHeight; },[logs]);
  const col = { order:"#c8a84b", error:"#ff6b6b", report:"#7be084", capiton:"#e0c97b", analyst:"#54a0e0", delta:"#c97be0", terminate:"#a0d0a0", info:"#777" };
  return (
    <div style={{ position:"relative" }}>
      <div ref={ref} style={{ height:200, overflowY:"auto", fontSize:FS.sm, lineHeight:1.8, background:"#0a0a0a", border:"1px solid #1a1a1a", borderRadius:8, padding:"12px 14px" }}>
        {!logs.length && <div style={{ color:"#333", fontStyle:"italic" }}>El sistema aguarda…</div>}
        {logs.map((l,i)=>(<div key={i} style={{ color:col[l.type]||"#555" }}><span style={{ color:"#333" }}>[{(l.cycle||0).toString().padStart(2,"0")}]</span> {l.text}</div>))}
      </div>
      <button onClick={onCopy} style={{ position:"absolute", top:8, right:8, background:"#1a1a1a", border:"1px solid #2a2a2a", color:copied?"#7be084":"#666", borderRadius:5, padding:"5px 10px", fontSize:FS.label, cursor:"pointer" }}>{copied?"✓":"Copiar"}</button>
    </div>
  );
}

function CreditCountdown() {
  const [state, setState] = useState({ exhausted: false, resumeAt: null });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Registrar como listener del creditState global
    const listener = () => setState({ exhausted: creditState.exhausted, resumeAt: creditState.resumeAt });
    creditState.listeners.add(listener);
    // Tick cada segundo para actualizar el countdown
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { creditState.listeners.delete(listener); clearInterval(tick); };
  }, []);

  if (!state.exhausted || !state.resumeAt) return null;

  const remaining = Math.max(0, state.resumeAt - now);
  const hh = String(Math.floor(remaining / 3600000)).padStart(2,"0");
  const mm = String(Math.floor((remaining % 3600000) / 60000)).padStart(2,"0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2,"0");

  return (
    <div style={{
      background:"#1a0d00", border:"2px solid #ff8c00",
      borderRadius:10, padding:"16px 18px", marginBottom:14,
      display:"flex", alignItems:"center", gap:14, flexWrap:"wrap",
    }}>
      <span style={{ fontSize:24 }}>⏸</span>
      <div style={{ flex:1 }}>
        <div style={{ color:"#ff8c00", fontSize:FS.sm, fontWeight:700, marginBottom:4 }}>
          CRÉDITOS AGOTADOS — EXPERIMENTO EN PAUSA
        </div>
        <div style={{ color:"#a06030", fontSize:FS.xs, lineHeight:1.5 }}>
          El experimento está congelado. Cuando se renueven los créditos, continuará automáticamente desde donde se detuvo. No cierres la pestaña.
        </div>
      </div>
      <div style={{ textAlign:"center", flexShrink:0 }}>
        <div style={{ fontFamily:"monospace", fontSize:28, fontWeight:700, color:"#ff8c00", letterSpacing:2 }}>
          {hh}:{mm}:{ss}
        </div>
        <div style={{ color:"#a06030", fontSize:FS.label }}>
          reintento a las {new Date(state.resumeAt).toLocaleTimeString()}
        </div>
        <button
          onClick={() => {
            creditState.exhausted = false;
            creditState.resumeAt = null;
            notifyCreditListeners();
          }}
          style={{
            marginTop:6, background:"#ff8c0033", color:"#ff8c00",
            border:"1px solid #ff8c0066", borderRadius:5,
            padding:"4px 10px", fontSize:FS.xs, cursor:"pointer",
          }}
        >
          Reintentar ahora
        </button>
      </div>
    </div>
  );
}

function ApiErrorLog() {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState([]);
  useEffect(()=>{
    const id = setInterval(()=>{ if(apiErrorLog.length !== snap.length) setSnap([...apiErrorLog]); }, 1000);
    return ()=>clearInterval(id);
  },[snap]);
  if (!snap.length) return null;
  return (
    <div style={{ background:"#1a0808", border:"1px solid #ff6b6b33", borderRadius:8, marginBottom:12, overflow:"hidden" }}>
      <div onClick={()=>setOpen(v=>!v)} style={{ padding:"8px 14px", display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
        <span style={{ color:"#ff6b6b", fontSize:FS.label, letterSpacing:2 }}>⚠ ERRORES API</span>
        <span style={{ background:"#ff6b6b33", color:"#ff6b6b", fontSize:FS.label, padding:"1px 6px", borderRadius:3 }}>{snap.length}</span>
        <span style={{ marginLeft:"auto", color:"#555", fontSize:FS.xs }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ padding:"0 14px 10px", maxHeight:180, overflowY:"auto" }}>
          {snap.map((e,i)=>(
            <div key={i} style={{ color:"#ff6b6b88", fontSize:FS.xs, fontFamily:"monospace", lineHeight:1.6, borderBottom:"1px solid #2a0808", marginBottom:2 }}>
              <span style={{ color:"#663333" }}>{new Date(e.ts).toISOString().slice(11,19)}</span> {e.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalReport({ history }) {
  // Excluir ciclos fallidos del reporte
  const valid = history.filter(m => !m.cycleFailed && m.J_col !== null);
  if (valid.length < 5) return null;
  const last5 = valid.slice(-5);
  const stat = key => {
    const vs = last5.map(m=>m[key]).filter(v=>v!==null);
    if (!vs.length) return null;
    return { min:Math.min(...vs), max:Math.max(...vs), mean:vs.reduce((a,b)=>a+b,0)/vs.length, trend: vs[vs.length-1]-vs[0] };
  };
  const J=stat("J_col"), Hh=stat("H_avg"), C=stat("conv");
  const fmt = s => s ? `μ=${s.mean.toFixed(3)} [${s.min.toFixed(2)},${s.max.toFixed(2)}] Δ=${s.trend>=0?"+":""}${s.trend.toFixed(3)}` : "—";
  const failedCount = history.filter(m=>m.cycleFailed).length;
  return (
    <div style={{ background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
      <div style={{ color:"#555", fontSize:FS.label, letterSpacing:2, marginBottom:6 }}>
        REPORTE LOCAL — ÚLTIMOS 5 CICLOS VÁLIDOS (sin LLM)
        {failedCount > 0 && <span style={{ color:"#ff6b6b", marginLeft:8 }}>⚠ {failedCount} ciclos fallidos excluidos</span>}
      </div>
      <div style={{ fontFamily:"monospace", fontSize:FS.xs, lineHeight:1.9 }}>
        <div style={{ color:"#e07b54" }}>J: {fmt(J)}</div>
        <div style={{ color:"#54a0e0" }}>H: {fmt(Hh)}</div>
        <div style={{ color:"#c97be0" }}>conv: {fmt(C)}</div>
      </div>
      {last5[last5.length-1]?.observation && (
        <div style={{ color:"#7a9a7a", fontSize:FS.xs, fontStyle:"italic", marginTop:8, borderTop:"1px solid #1a1a1a", paddingTop:8, lineHeight:1.6 }}>
          ◎ {last5[last5.length-1].observation}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_PARAMS = {
  temperature: 0.58,
  initAnclaje: 0.30,
  anclajeDecayPenalty: 0.016,
  memoryDepth: 4,
  convergenceTarget: 0.20,       // recalibrado: 0.30→0.20 (alcanzable según datos)
  customVocabEnabled: false,
  customVocab: VOCAB_BUDDHIST.split(",").map(s=>s.trim()),
};
const stripPreset = p => { const { label, keyHint, ...rest } = p; return rest; };

export default function LacanMASv9() {
  const [mode, setMode] = useState("neutral");
  const [seed, setSeed] = useState(42);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [agentCfg, setAgentCfg] = useState({ provider:"anthropic", ...stripPreset(PROVIDER_PRESETS.anthropic), apiKey:"" });
  const [observerCfg, setObserverCfg] = useState({ provider:"anthropic", ...stripPreset(PROVIDER_PRESETS.anthropic), apiKey:"" });
  const [observerEnabled, setObserverEnabled] = useState(false);

  const [runState, setRunState] = useState(() => createRunState("neutral", DEFAULT_PARAMS, 42));
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [activeAgent, setActiveAgent] = useState(null);
  const [copied, setCopied] = useState(false);
  const autoRef = useRef(false);
  const logsRef = useRef([]);
  const stateRef = useRef(runState);

  const addLog = useCallback((text, type="info", c=0) => {
    setLogs(prev => { const next=[...prev,{text,type,cycle:c}].slice(-400); logsRef.current=next; return next; });
  }, []);

  const [logExpanded, setLogExpanded] = useState(false);

  const handleCopy = () => {
    // navigator.clipboard puede estar bloqueado en el sandbox — usamos select+copy
    const text = logsRef.current.map(l=>`[${(l.cycle||0).toString().padStart(2,"0")}] ${l.text}`).join("\n");
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch(e) {}
    document.body.removeChild(ta);
  };

  const reset = useCallback((newMode=mode, newSeed=seed, newParams=params) => {
    const st = createRunState(newMode, newParams, newSeed);
    stateRef.current = st;
    setRunState(st);
    setLogs([]); logsRef.current = [];
    setAutoRun(false); setRunning(false); setActiveAgent(null);
    apiErrorLog.length = 0;
  }, [mode, seed, params]);

  const handleModeChange = (m) => {
    if (stateRef.current.cycle > 0 && !confirm("Cambiar de modo reinicia la simulación. ¿Continuar?")) return;
    setMode(m); reset(m, seed, params);
  };

  const step = async () => {
    if (running) return;
    setRunning(true);
    await engineCycle(stateRef.current, {
      agentCfg,
      observerCfg: observerEnabled ? observerCfg : null,
      log: addLog,
      setActive: id => setActiveAgent(id),
    });
    setActiveAgent(null);
    setRunState({ ...stateRef.current });
    setRunning(false);
  };

  useEffect(()=>{ autoRef.current=autoRun; },[autoRun]);
  useEffect(()=>{
    if (!autoRun) return;
    let stopped = false;
    (async () => {
      while (autoRef.current && !stopped && stateRef.current.termination.psychosisStreak < 3) {
        setRunning(true);
        await engineCycle(stateRef.current, {
          agentCfg, observerCfg: observerEnabled ? observerCfg : null,
          log: addLog, setActive: id => setActiveAgent(id),
        });
        setActiveAgent(null);
        setRunState({ ...stateRef.current });
        setRunning(false);
        await sleep(800);
      }
      setAutoRun(false);
    })();
    return ()=>{ stopped=true; };
  },[autoRun]);

  const st = runState;
  const t = st.termination;

  return (
    <div style={{ minHeight:"100vh", background:"#212121", color:"#ececec", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding:"20px 16px", maxWidth:740, margin:"0 auto" }}>
      <style>{`*{box-sizing:border-box} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#1a1a1a} ::-webkit-scrollbar-thumb{background:#333;border-radius:2px} input[type=range]{height:4px}`}</style>

      <div style={{ marginBottom:16 }}>
        <div style={{ color:"#555", fontSize:FS.label, letterSpacing:3, textTransform:"uppercase", marginBottom:4 }}>Sistema Multiagente v9 · Instrumento</div>
        <h1 style={{ margin:0, fontSize:FS.xl, fontWeight:600, color:"#e0c97b" }}>Métricas Determinísticas</h1>
        <div style={{ color:"#555", fontSize:FS.sm, marginTop:4, fontStyle:"italic" }}>Multi-proveedor · Seed · Batch CSV · Ningún LLM mide</div>
        {params.customVocabEnabled && params.customVocab?.length > 0 && (
          <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ color:"#c97be0", fontSize:FS.label, letterSpacing:1 }}>⟳ VOCAB ROTADO</span>
            <span style={{ color:"#7a4a8a", fontSize:FS.xs }}>{params.customVocab.slice(0,6).join(" · ")}{params.customVocab.length>6?` +${params.customVocab.length-6}`:""}</span>
          </div>
        )}
      </div>

      <ModeSelector mode={mode} onChange={handleModeChange} disabled={running||autoRun} />

      <ProviderConfig title="PROVEEDOR — AGENTES" cfg={agentCfg} onChange={setAgentCfg} accent="#e0c97b" />
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
        <label style={{ display:"flex", alignItems:"center", gap:8, color:"#888", fontSize:FS.sm, cursor:"pointer" }}>
          <input type="checkbox" checked={observerEnabled} onChange={e=>setObserverEnabled(e.target.checked)} style={{ accentColor:"#54a0e0" }} />
          Observador narrativo cada 5 ciclos (idealmente otra familia de modelos)
        </label>
      </div>
      {observerEnabled && <ProviderConfig title="PROVEEDOR — OBSERVADOR" cfg={observerCfg} onChange={setObserverCfg} accent="#54a0e0" />}

      <ExperimentalParams params={params} onChange={setParams} disabled={running||autoRun} seed={seed} setSeed={setSeed} onApply={()=>reset(mode, seed, params)} />

      <BatchPanel mode={mode} params={params} agentCfg={agentCfg} disabled={running||autoRun} />

      <CreditCountdown />
      <TerminationBanner t={t} mode={mode} />
      <TerminationConditions t={t} convTarget={params.convergenceTarget} />

      <div style={{ display:"flex", gap:14, marginBottom:12, padding:"10px 14px", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:10, alignItems:"center" }}>
        <div><div style={{ color:"#555", fontSize:FS.label }}>CICLO</div><div style={{ color:"#ccc", fontSize:FS.lg, fontWeight:700 }}>{st.cycle.toString().padStart(3,"0")}</div></div>
        <div style={{ flex:1, fontFamily:"monospace", fontSize:FS.sm, color:"#888" }}>
          J={t.liveJ?.toFixed(3)||"—"} · H={t.liveH?.toFixed(3)||"—"} · conv={t.liveConv?.toFixed(3)||"—"}
        </div>
        <div style={{ color:"#555", fontSize:FS.xs, fontFamily:"monospace" }}>seed={st.seed}</div>
      </div>

      <MetricsChart history={st.metricsHistory} />
      <LocalReport history={st.metricsHistory} />

      {mode === "directed" && st.capiton && (
        <div style={{ background:"#13100a", border:"1px solid #e0c97b44", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
          <span style={{ color:"#e0c97b", fontSize:FS.sm, fontWeight:700 }}>⬡ {st.capiton}</span>
          {st.capitonJust && <div style={{ color:"#9a8a5a", fontSize:FS.xs, marginTop:4, lineHeight:1.5 }}>{st.capitonJust}</div>}
        </div>
      )}
      {mode === "directed" && (
        <div style={{ background:"#0e0e0e", border:"1px solid #1e1e1e", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
          <div style={{ color:"#555", fontSize:FS.label, letterSpacing:2, marginBottom:6 }}>ORDEN SIMBÓLICO</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {st.order.map((s,i)=>(
              <span key={i} style={{ color:i===st.order.length-1?"#e0c97b":"#555", fontSize:FS.sm }}>{s}{i<st.order.length-1?" →":""}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gap:8, marginBottom:14 }}>
        {st.agents.map(a=>(
          <NodeCard key={a.id} agent={a} isActive={activeAgent===a.id} mode={mode} />
        ))}
      </div>

      <div style={{ marginBottom:12 }}>
        <div style={{ color:"#555", fontSize:FS.label, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Registro</div>
        <CycleLog logs={logs} onCopy={handleCopy} copied={copied} />
      </div>

      <ApiErrorLog />

      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <button onClick={step} disabled={running||autoRun} style={{
          background:(running||autoRun)?"#2a2a2a":mode==="directed"?"#e0c97b":"#54a0e0",
          color:(running||autoRun)?"#555":"#000", border:"none", borderRadius:8, padding:"12px 24px",
          cursor:(running||autoRun)?"default":"pointer", fontSize:FS.sm, fontWeight:600,
        }}>{running?"Procesando…":"Ciclo →"}</button>
        <button onClick={()=>setAutoRun(v=>!v)} disabled={running&&!autoRun} style={{
          background:autoRun?"#3a1a1a":"#2a2a2a", color:autoRun?"#ff6b6b":"#aaa",
          border:`1px solid ${autoRun?"#ff6b6b44":"#333"}`, borderRadius:8, padding:"12px 24px",
          cursor:"pointer", fontSize:FS.sm, fontWeight:600,
        }}>{autoRun?"■ Detener":"▶ Auto"}</button>
        <button onClick={()=>reset()} style={{ marginLeft:"auto", background:"transparent", color:"#555", border:"1px solid #2a2a2a", borderRadius:8, padding:"10px 16px", cursor:"pointer", fontSize:FS.sm }}>Reset</button>
      </div>

      <div style={{ marginTop:14, color:"#333", fontSize:FS.xs, lineHeight:1.8 }}>
        v9 · J/H/conv computadas localmente (Shannon + Jaccard texto completo) · J_col = promedio [0,1]: sutura&lt;{SUTURE_J}, psicosis&gt;{PSYCH_J} · seed reproducible · batch CSV · proveedores: Anthropic / OpenAI / Ollama / llama.cpp · retroescritura eliminada por razones metodológicas
      </div>
    </div>
  );
}
