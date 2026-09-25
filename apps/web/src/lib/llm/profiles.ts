/**
 * Which model runs which step.
 *
 * This is a port of the idea in backend/src/atsresume/config.py, and the idea
 * is the point: the cost and latency dial lives in exactly one table, not
 * spelled out at each call site, so changing it is one edit and one diff.
 *
 * The shape of the decision carries over from the Anthropic pipeline even
 * though the models do not. Four of the five steps are mechanical: pulling
 * structured facts out of a resume, decomposing a posting, comparing two
 * structured objects, and writing advice about a number that was already
 * computed. A small model does those as well as a large one. The rewrite is
 * the exception, because it is the step whose quality decides whether the
 * resume survives a first screen, and cutting cost there is cutting the
 * product.
 *
 * One lesson worth keeping from the measurements on the old stack: putting the
 * rewrite on the cheaper model made the pipeline SLOWER, not faster, because
 * the cheaper model spent longer reasoning on that task. So `fast` does not
 * buy speed by downgrading the rewrite; it buys it by lowering reasoning
 * effort. Assume the same trap exists here until measured otherwise.
 *
 * Every number in this file is a hypothesis until backend/evals has run
 * against it. Do not quote them at anyone.
 */

export type Step = "extract" | "analyze" | "gaps" | "tailor" | "strategy" | "chat" | "rewrite" | "evidence";

export type Effort = "minimal" | "low" | "medium" | "high";

export type StepConfig = {
  model: string;
  effort: Effort;
  /** Ceiling for one response. A resume is small; a runaway is not. */
  maxOutputTokens: number;
};

export type ProfileName = "fast" | "balanced" | "thorough";

/**
 * Model ids are read from the environment rather than hardcoded, because the
 * one thing guaranteed about a model id is that it changes, and a redeploy to
 * move a string is a redeploy nobody schedules.
 */
const SMALL = process.env.LLM_MODEL_SMALL ?? "gpt-4o-mini";
const LARGE = process.env.LLM_MODEL_LARGE ?? "gpt-5.3-codex";

/**
 * Whether a model accepts `reasoning.effort`.
 *
 * Not every model does, and asking one that does not is a hard 400 rather
 * than a politely ignored field: "Unsupported parameter: 'reasoning.effort'
 * is not supported with this model." The defaults above are split exactly
 * along this line, so sending the parameter unconditionally broke every
 * call on the small model.
 *
 * A prefix list rather than a lookup table, because the set is open and a
 * table would silently mis-answer for a model nobody has added to it yet.
 * The conservative direction is to omit the parameter: a model that could
 * have reasoned and was not asked to still answers.
 */
export function supportsReasoning(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/.test(model);
}

export const PROFILES: Record<ProfileName, Record<Step, StepConfig>> = {
  fast: {
    extract: { model: SMALL, effort: "low", maxOutputTokens: 16_000 },
    analyze: { model: SMALL, effort: "low", maxOutputTokens: 16_000 },
    gaps: { model: SMALL, effort: "low", maxOutputTokens: 12_000 },
    tailor: { model: LARGE, effort: "low", maxOutputTokens: 24_000 },
    strategy: { model: SMALL, effort: "minimal", maxOutputTokens: 8_000 },
    chat: { model: SMALL, effort: "low", maxOutputTokens: 8_000 },
    // One line in, one line out. The cheapest call in the product and the
    // only one someone waits on with the cursor still in the document, so
    // it is small and low effort in every profile.
    rewrite: { model: SMALL, effort: "low", maxOutputTokens: 1_500 },
    evidence: { model: SMALL, effort: "low", maxOutputTokens: 1_500 },
  },
  balanced: {
    extract: { model: SMALL, effort: "medium", maxOutputTokens: 16_000 },
    analyze: { model: SMALL, effort: "medium", maxOutputTokens: 16_000 },
    // Pure input-to-input reasoning and the cheapest place to buy wall clock
    // back, which is why it sits a rung below analyze rather than above it.
    gaps: { model: SMALL, effort: "low", maxOutputTokens: 12_000 },
    tailor: { model: LARGE, effort: "medium", maxOutputTokens: 24_000 },
    strategy: { model: SMALL, effort: "low", maxOutputTokens: 8_000 },
    chat: { model: LARGE, effort: "low", maxOutputTokens: 8_000 },
    rewrite: { model: SMALL, effort: "low", maxOutputTokens: 1_500 },
    evidence: { model: SMALL, effort: "low", maxOutputTokens: 1_500 },
  },
  thorough: {
    extract: { model: LARGE, effort: "medium", maxOutputTokens: 16_000 },
    analyze: { model: LARGE, effort: "high", maxOutputTokens: 16_000 },
    gaps: { model: LARGE, effort: "high", maxOutputTokens: 12_000 },
    tailor: { model: LARGE, effort: "high", maxOutputTokens: 32_000 },
    strategy: { model: LARGE, effort: "medium", maxOutputTokens: 8_000 },
    chat: { model: LARGE, effort: "medium", maxOutputTokens: 8_000 },
    rewrite: { model: LARGE, effort: "low", maxOutputTokens: 1_500 },
    evidence: { model: LARGE, effort: "low", maxOutputTokens: 1_500 },
  },
};

export function activeProfile(): ProfileName {
  const name = (process.env.LLM_PROFILE ?? "balanced") as ProfileName;
  return name in PROFILES ? name : "balanced";
}

export function configFor(step: Step): StepConfig {
  return PROFILES[activeProfile()][step];
}

/**
 * USD per million tokens: [input, cachedInput, output].
 *
 * Used only to report what a run cost. Nothing branches on it. It exists
 * because cost was the loudest complaint about the previous pipeline and it
 * was invisible, which is how a single run reached two dollars unnoticed.
 *
 * Set LLM_PRICES to a JSON object to correct these without a deploy. They are
 * transcribed from published rates and published rates move.
 */
const DEFAULT_PRICES: Record<string, [number, number, number]> = {
  "gpt-5": [1.25, 0.125, 10.0],
  "gpt-5-mini": [0.25, 0.025, 2.0],
  "gpt-5-nano": [0.05, 0.005, 0.4],
};

let pricesCache: Record<string, [number, number, number]> | null = null;

export function prices(): Record<string, [number, number, number]> {
  if (pricesCache) return pricesCache;
  pricesCache = { ...DEFAULT_PRICES };
  const override = process.env.LLM_PRICES;
  if (override) {
    try {
      Object.assign(pricesCache, JSON.parse(override));
    } catch {
      // A malformed override must not take the pipeline down over a number
      // that only ever appears in a report.
      console.warn("[llm] LLM_PRICES is not valid JSON; using defaults");
    }
  }
  return pricesCache;
}

export function costOf(
  model: string,
  usage: { input: number; cachedInput: number; output: number },
): number {
  const [pIn, pCached, pOut] = prices()[model] ?? [1.25, 0.125, 10.0];
  return (
    (usage.input - usage.cachedInput) * pIn +
    usage.cachedInput * pCached +
    usage.output * pOut
  ) / 1_000_000;
}
