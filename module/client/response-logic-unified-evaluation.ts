import type { ResponseLogicRuleEvaluation } from "./response-logic-evaluation-client.js";

export type UnifiedEvaluationDeps = {
  /** Fires the rule evaluation request; resolves null when it fails. */
  runRuleEvaluation: () => Promise<ResponseLogicRuleEvaluation | null>;
  /** Fires the LLM-as-Judge task start; self-guards duplicate starts. */
  startJudgeEvaluation: () => Promise<void>;
  /** Shows the unified four-dimension report view. */
  enterEvaluationView: () => void;
};

/**
 * Starts rule evaluation and the LLM-as-Judge in parallel and integrates
 * them into the unified four-dimension report.
 *
 * The judge backend recomputes the rule evaluation itself when building its
 * turn-input, so the two requests never depend on each other: rule results
 * render as soon as they arrive while the judge task keeps running, and
 * either side failing leaves the other untouched. The view switches only on
 * rule success — a failed rule evaluation keeps the user on the detail view
 * with the error plus retry entry, while the judge task runs independently.
 */
export async function startUnifiedEvaluation(deps: UnifiedEvaluationDeps): Promise<void> {
  // Judge failures are surfaced through its own lifecycle state, so swallow
  // them here to keep the rule evaluation chain free of unhandled rejections.
  void Promise.resolve()
    .then(() => deps.startJudgeEvaluation())
    .catch(() => undefined);
  const evaluation = await deps.runRuleEvaluation();
  if (evaluation) deps.enterEvaluationView();
}
