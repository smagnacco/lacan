# Findings: Lexical Convergence in Multi-Agent LLM Systems

## Summary

This document reports the empirical findings of a multi-agent LLM experiment that began
as a computational model of Lacanian psychoanalytic structure and evolved into a controlled
study of lexical convergence between conversing language models.

The headline result is methodological rather than theoretical:

> **Lexical convergence between multi-agent LLMs is driven by the symmetry of their prompt
> architecture, not by the theoretical vocabulary imposed on them.**

What earlier iterations interpreted as the emergence of "Lacanian structure" turned out to
be an artifact of a loaded theoretical frame applied to ordinary LLM behavior. When the frame
was removed (neutral control) and when the vocabulary was rotated (Buddhist terms), the
measurable dynamics did not follow the theory — they followed the architecture.

This is not a refutation of Lacan. It is a result about LLM multi-agent systems that happens
to use psychoanalytic vocabulary as one of its experimental conditions.

---

## Experimental Setup

Four LLM agents (α, β, γ, δ) exchange short Spanish texts over a series of cycles. Each cycle
introduces one abstract noun ("signifier") drawn deterministically from a seeded sequence.
Agents respond, then observe the responses of the others.

Two modes were compared:

- **Directed mode** — asymmetric prompts. Agents α, β, γ are framed as differentiated
  "psychotic" structures; δ is framed as an "analyst" (Lacanian Sujeto Supuesto Saber).
  This is the theory-loaded condition.
- **Neutral mode** — symmetric prompts. All four agents receive an identical, theory-free
  prompt instructing them only to generate text about the current word. This is the control.

A third condition rotated the vocabulary in directed mode from Lacanian terms to Buddhist
terms (Vacío, Apego, Karma, Iluminación, Samsara, etc.) to isolate the effect of vocabulary
from the effect of architecture.

### Metrics (all deterministic, computed locally — no LLM is used to measure)

| Metric | Definition | Range |
|---|---|---|
| **H** (lexical entropy) | Normalized Shannon entropy of the cycle's tokens | [0,1] |
| **selfRep** | Jaccard overlap of an agent's vocabulary vs its previous 2 cycles | [0,1] |
| **J** (lexical rigidity) | `0.6·selfRep + 0.4·(1−H)` — proxy for fixity | [0,1] |
| **J_col** | Mean J across agents | [0,1] |
| **conv** (convergence) | Mean pairwise Jaccard between agents' full vocabularies | [0,1] |

All metrics are deterministic functions of the generated text. No model judges another model.
A seeded RNG (mulberry32) makes the signifier sequence reproducible across runs.

### Termination conditions (recalibrated from empirical data)

- **Lacanian**: `J_col < 0.05` for 3 consecutive cycles
- **Neutral**: `H_avg ∈ [0.85, 1.00]` AND `conv > 0.20` for 3 consecutive cycles

Both conditions are tracked simultaneously; the first to trigger ends the run, but the other
continues to be measured.

---

## Results

### Aggregate comparison (valid runs only)

| Configuration | n | J_col (mean) | H_avg (mean) | conv (mean) | Lacanian met |
|---|---|---|---|---|---|
| Neutral (Lacanian vocab) | 9 | 0.052 | 0.993 | **0.176** | 6/9 |
| Directed (Lacanian vocab) | 6 | 0.044 | 0.991 | **0.083** | 2/6 |
| Directed (Buddhist vocab) | 5 | 0.054 | 0.991 | **0.080** | 5/5 |

Runs that failed due to API credit exhaustion were detected automatically, flagged as
`FAILED` in the data, and excluded from all aggregates. They do not contaminate the means.

### Key observations

**1. Convergence depends on architecture, not vocabulary.**
Neutral (symmetric) mode produces roughly twice the lexical convergence of directed
(asymmetric) mode: 0.176 vs 0.083. Rotating the directed vocabulary from Lacanian to Buddhist
left convergence essentially unchanged (0.083 → 0.080). The theoretical content of the words
did not matter; the symmetry of the prompts did.

**2. J and H are properties of "LLMs writing short Spanish," not of the frame.**
Lexical rigidity (J ≈ 0.05) and entropy (H ≈ 0.99) are nearly identical across all three
conditions. These metrics reflect the base behavior of the underlying model, independent of
the theoretical framing applied to it.

**3. The Lacanian termination condition is weakly selective.**
Even after recalibration to `J_col < 0.05`, the condition fired in 13 of 20 valid runs (65%).
Short Spanish responses reach low rigidity easily; this threshold should likely be tightened
further (e.g. `J_col < 0.02`) for the condition to carry information.

**4. The neutral (convergence-based) condition is genuinely rare.**
It fired in only 1 of 20 valid runs. Sustained lexical convergence between independent LLMs is
hard to achieve and does not arise automatically from conversation. When it does occur (e.g.
seed 1004, neutral mode), convergence grows monotonically across cycles rather than spiking
and collapsing — suggesting a real, if uncommon, coordination dynamic.

---

## Interpretation

The project's early iterations reported a dramatic result: a "genuine suture" in which an
analyst agent (δ) stabilized three others in five cycles. Subsequent controlled experiments
showed that this reading did not survive scrutiny:

- The "suture" metric (low collective jouissance) is reached just as easily — in fact more
  easily — by neutral agents with no theoretical framing.
- The convergence that the theory would predict from a successful analytic intervention does
  not appear in directed mode; it appears more strongly in the neutral control.
- Rotating the vocabulary demonstrated that the dynamics are indifferent to which theory's
  words are used.

The most defensible conclusion is architectural: **in multi-agent LLM systems, the symmetry of
the prompt design governs lexical coordination. A theory-loaded vocabulary is an interchangeable
skin over that architecture, not a cause of the observed behavior.**

This does not test Lacanian theory as an account of the human psyche. It tests whether a
Lacanian *computational scaffold* produces distinctive behavior in LLMs — and the answer is
that the scaffold's distinctiveness comes from its structural asymmetry, not its concepts.

---

## Threats to Validity

- **Unequal and incomplete samples.** Credit exhaustion truncated several batches. Directed
  Lacanian has n=6, Buddhist has n=5, neutral has n=9. Conclusions are preliminary, not
  definitive, and should be replicated with a local model (Ollama / llama.cpp) to remove the
  credit constraint and reach a clean n=10 per condition.
- **Single underlying model.** All agents and the (now removed) measuring step shared one model
  family. Independence between agents is only architectural, not model-level.
- **Self-repetition edge case.** One run (Buddhist seed 1005, cycle 10) spiked to J=0.43 with
  conv=0.00, likely an agent repeating its previous text. Isolated; does not affect aggregates.
- **Threshold sensitivity.** The Lacanian condition remains weakly selective even after
  recalibration. Reported "condition met" rates should be read as threshold-dependent, not
  as evidence of a phenomenon.
- **Language and length.** All outputs are short Spanish texts. The near-ceiling entropy
  (H ≈ 0.99) may be partly an artifact of short, varied responses and may not generalize to
  longer generations or other languages.

---

## Reproducibility

- Metrics are deterministic; given the same generated texts, J/H/conv are exactly reproducible.
- The signifier sequence is seeded (mulberry32). Same seed ⇒ same word order across runs and
  modes, enabling row-by-row comparison between conditions.
- Batch mode emits one CSV row per cycle, including the termination state and a `FAILED` marker
  for cycles or runs lost to API errors.
- No LLM is used to compute any reported number. An optional "observer" model can narrate state
  in prose but produces no metrics.

### CSV schema

```
run, seed, mode, cycle, signifier, J_col, H_avg, conv, A_col,
lacanianStreak, neutralStreak, lacanianCycle, neutralCycle, firstCondition
```

Failed cycles carry `FAILED` in the metric columns; aborted runs carry a
`run_aborted_<n>_failed_cycles` marker in `firstCondition`.

---

## Suggested Next Steps

1. **Clean replication on a local model** (Ollama with Gemma, or llama.cpp) to obtain n=10 per
   condition without credit interruptions.
2. **Tighten the Lacanian threshold** to `J_col < 0.02` and lengthen the required streak so the
   condition becomes informative rather than near-default.
3. **Symmetry gradient.** Vary how asymmetric the directed prompts are (e.g. 1, 2, 3
   differentiated agents) to map the relationship between architectural asymmetry and
   convergence.
4. **Cross-family observer.** Use a different model family for any narrative or judgment step to
   ensure independence from the agents.
5. **Longer generations / other languages** to test whether the near-ceiling entropy is an
   artifact of short Spanish responses.

---

## One-Line Takeaway

> In multi-agent LLM conversation, *how you structure the prompts* — symmetric vs asymmetric —
> shapes lexical convergence far more than *which theory's vocabulary* you pour into them.
