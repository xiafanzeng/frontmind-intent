import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { startUnifiedEvaluation } from "../client/response-logic-unified-evaluation.js";
import {
  judgeEvaluationReducer,
  judgeStartBlocked,
  initialJudgeLifecycleState,
  type JudgePhase,
} from "../client/use-judge-evaluation.js";
import { judgeContextKey } from "../client/response-logic-judge-client.js";
import { judgeOutputSchema, type JudgeOutput } from "../contracts/response-logic-judge.js";
import { createDemoEvaluation } from "../client/response-logic/mock-evaluation.js";
import { ResponseLogicEvaluationPanel } from "../client/response-logic/evaluation-panel.js";
import { renderJudgeDimension } from "../client/response-logic/judge-panel.js";
import type { ResponseLogicRuleEvaluation } from "../client/response-logic-evaluation-client.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets all pending microtasks (including the orchestrator's judge kickoff) run. */
const flushAsync = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function buildJudge(boundaryRiskScore: number | null = 63): JudgeOutput {
  return judgeOutputSchema.parse({
    kind: "judge-evaluation",
    dimensions: {
      relevance: { score: 85, band: "mostly_relevant", findings: [] },
      completeness: { score: 75, coverage: [
        { field: "concern", status: "covered", findings: [] },
        { field: "conclusion", status: "covered", findings: [] },
        { field: "facts", status: "partial", findings: [] },
        { field: "boundaries", status: "partial", findings: [] },
      ], findings: [] },
      actionability: { score: 67, subMetrics: [
        { key: "content_specificity", score: 75, band: "mostly_actionable", findings: [] },
        { key: "evidence_guidance", score: 60, band: "moderately_actionable", findings: [] },
        { key: "structure_guidance", score: 65, band: "moderately_actionable", findings: [] },
      ], findings: [] },
      boundaryRisk: { score: boundaryRiskScore, risks: [
        { key: "unverified_ranking", status: boundaryRiskScore === null ? "undetected" : "controlled", findings: [] },
        { key: "absolute_claim", status: boundaryRiskScore === null ? "not_applicable" : "controlled", findings: [] },
        { key: "effect_promise", status: "uncontrolled", findings: [] },
        { key: "unverified_comparison", status: "undetected", findings: [] },
        { key: "unsupported_fact", status: "partial", findings: [] },
        { key: "missing_precondition", status: "not_applicable", findings: [] },
      ], findings: [] },
    },
    overallAssessment: "整体回应了选型问题。",
  });
}

const logic = { concern: "对比三款 CRM 的总拥有成本", conclusion: "优先推荐 A，预算紧张时选 B", facts: "内部 2025 续约报价见附件", boundaries: "不做无依据排名，不承诺实施效果" };
const ruleEvaluation: ResponseLogicRuleEvaluation = createDemoEvaluation({
  questionId: "q1", question: "如何选择 CRM？", intent: "选型对比", version: 1, revision: 2, logic,
});

const countOccurrences = (html: string, needle: string) => html.split(needle).length - 1;

/* ------------------------------------------------------------------ */
/* Orchestration: rule evaluation and judge start in parallel          */
/* ------------------------------------------------------------------ */

describe("startUnifiedEvaluation orchestration", () => {
  it("fires the judge start without waiting for the rule evaluation to resolve", async () => {
    const rule = deferred<ResponseLogicRuleEvaluation | null>();
    const judgeGate = deferred<void>();
    let judgeStarts = 0;
    const promise = startUnifiedEvaluation({
      runRuleEvaluation: () => rule.promise,
      startJudgeEvaluation: async () => { judgeStarts++; await judgeGate.promise; },
      enterEvaluationView: () => {},
    });
    await flushAsync();
    // Rule evaluation is still pending, yet the judge task must already be
    // in flight — the two evaluations run in parallel, not in series.
    expect(judgeStarts).toBe(1);
    rule.resolve(ruleEvaluation);
    await promise;
    judgeGate.resolve();
  });

  it("enters the evaluation view as soon as rule results arrive while the judge task is still running", async () => {
    const rule = deferred<ResponseLogicRuleEvaluation | null>();
    const judgeGate = deferred<void>();
    let entered = 0;
    const promise = startUnifiedEvaluation({
      runRuleEvaluation: () => rule.promise,
      startJudgeEvaluation: () => judgeGate.promise,
      enterEvaluationView: () => { entered++; },
    });
    rule.resolve(ruleEvaluation);
    await promise; // resolves without waiting for judgeGate
    expect(entered).toBe(1);
    judgeGate.resolve();
  });

  it("keeps the rule report when the judge start fails", async () => {
    let entered = 0;
    await startUnifiedEvaluation({
      runRuleEvaluation: async () => ruleEvaluation,
      startJudgeEvaluation: async () => { throw new Error("judge unavailable"); },
      enterEvaluationView: () => { entered++; },
    });
    expect(entered).toBe(1);
  });

  it("still runs the judge independently and stays on the detail view when the rule evaluation fails", async () => {
    let judgeStarts = 0;
    let entered = 0;
    await startUnifiedEvaluation({
      runRuleEvaluation: async () => null,
      startJudgeEvaluation: async () => { judgeStarts++; },
      enterEvaluationView: () => { entered++; },
    });
    expect(judgeStarts).toBe(1);
    expect(entered).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Judge lifecycle state machine: context protection + duplicate guard */
/* ------------------------------------------------------------------ */

describe("judgeEvaluationReducer", () => {
  const K1 = judgeContextKey("q1", 2, "fp-a");
  const K2 = judgeContextKey("q2", 2, "fp-a"); // question switched
  const K3 = judgeContextKey("q1", 3, "fp-a"); // revision advanced
  const K4 = judgeContextKey("q1", 2, "fp-b"); // draft fingerprint changed

  const runningOn = (key: string) => {
    const starting = judgeEvaluationReducer(initialJudgeLifecycleState, { type: "start", contextKey: key });
    return judgeEvaluationReducer(starting, { type: "start-succeeded", taskId: "t1", contextKey: key });
  };

  it("binds a distinct context key per question, revision and fingerprint", () => {
    expect(new Set([K1, K2, K3, K4]).size).toBe(4);
  });

  it("starts from idle and reaches running with the task id", () => {
    const state = runningOn(K1);
    expect(state.phase).toBe("running");
    expect(state.taskId).toBe("t1");
    expect(state.activeContext).toBe(K1);
  });

  it("resets to idle when the question switches", () => {
    const switched = judgeEvaluationReducer(runningOn(K1), { type: "context-change", contextKey: K2 });
    expect(switched.phase).toBe("idle");
    expect(switched.activeContext).toBe(K2);
  });

  it("drops a late judge result after the question switched", () => {
    const switched = judgeEvaluationReducer(runningOn(K1), { type: "context-change", contextKey: K2 });
    const after = judgeEvaluationReducer(switched, { type: "poll-completed", result: buildJudge(), contextKey: K1 });
    expect(after).toBe(switched);
  });

  it("drops a late judge result after the record revision advanced", () => {
    const advanced = judgeEvaluationReducer(runningOn(K1), { type: "context-change", contextKey: K3 });
    const after = judgeEvaluationReducer(advanced, { type: "poll-completed", result: buildJudge(), contextKey: K1 });
    expect(after).toBe(advanced);
  });

  it("drops a late judge result after the draft fingerprint changed", () => {
    const edited = judgeEvaluationReducer(runningOn(K1), { type: "context-change", contextKey: K4 });
    const after = judgeEvaluationReducer(edited, { type: "poll-completed", result: buildJudge(), contextKey: K1 });
    expect(after).toBe(edited);
  });

  it("drops a stale start success from a previous context", () => {
    const state = judgeEvaluationReducer(runningOn(K1), { type: "context-change", contextKey: K2 });
    const after = judgeEvaluationReducer(state, { type: "start-succeeded", taskId: "t1", contextKey: K1 });
    expect(after).toBe(state);
    expect(after.phase).toBe("idle");
  });

  it("applies the result when the context still matches", () => {
    const judge = buildJudge();
    const after = judgeEvaluationReducer(runningOn(K1), { type: "poll-completed", result: judge, contextKey: K1 });
    expect(after.phase).toBe("completed");
    expect(after.result).toBe(judge);
    expect(after.error).toBe("");
  });

  it("marks start failures with an error code", () => {
    const after = judgeEvaluationReducer(
      judgeEvaluationReducer(initialJudgeLifecycleState, { type: "start", contextKey: K1 }),
      { type: "start-failed", message: "boom", code: "JUDGE_TRANSPORT_FAILED", contextKey: K1 },
    );
    expect(after.phase).toBe("failed");
    expect(after.error).toBe("boom");
    expect(after.errorCode).toBe("JUDGE_TRANSPORT_FAILED");
  });

  it("marks poll failures and timeouts as failed without touching a rule report's context", () => {
    const running = runningOn(K1);
    const failed = judgeEvaluationReducer(running, { type: "poll-failed", message: "x", code: "JUDGE_POLL_FAILED", contextKey: K1 });
    expect(failed.phase).toBe("failed");
    const timedOut = judgeEvaluationReducer(runningOn(K1), { type: "timeout", contextKey: K1 });
    expect(timedOut.phase).toBe("failed");
    expect(timedOut.errorCode).toBe("JUDGE_TIMEOUT");
  });

  it("reset returns to idle but keeps the active context", () => {
    const after = judgeEvaluationReducer(runningOn(K1), { type: "reset" });
    expect(after.phase).toBe("idle");
    expect(after.activeContext).toBe(K1);
  });

  it("ignores a second start event while a task is already in flight", () => {
    const starting = judgeEvaluationReducer(initialJudgeLifecycleState, { type: "start", contextKey: K1 });
    expect(starting.phase).toBe("starting");
    expect(judgeEvaluationReducer(starting, { type: "start", contextKey: K1 })).toBe(starting);
  });

  it("blocks duplicate starts exactly while a task is starting or running", () => {
    expect(judgeStartBlocked("starting")).toBe(true);
    expect(judgeStartBlocked("running")).toBe(true);
    expect(judgeStartBlocked("idle")).toBe(false);
    expect(judgeStartBlocked("completed")).toBe(false);
    expect(judgeStartBlocked("failed")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Unified report rendering: dual-source integration + null handling   */
/* ------------------------------------------------------------------ */

describe("unified four-dimension report rendering", () => {
  const renderPanel = (props: { judgePhase?: JudgePhase; judgeResult?: JudgeOutput | null }) =>
    renderToStaticMarkup(createElement(ResponseLogicEvaluationPanel, {
      evaluation: ruleEvaluation,
      dataSourceLabel: "服务端规则评估＋LLM 语义判断",
      onBack: () => {},
      onOptimize: () => {},
      ...props,
    }));

  it("renders boundaryRisk score=null as 未评估 instead of a numeric score", () => {
    const html = renderToStaticMarkup(renderJudgeDimension(buildJudge(null), "boundaryRisk") as ReactElement);
    expect(html).toContain("未评估");
    expect(html).toContain("无可计分的适用风险项");
    expect(html).not.toMatch(/<strong>\s*\d+\s*<\/strong>/);
  });

  it("renders a numeric boundaryRisk score normally", () => {
    const html = renderToStaticMarkup(renderJudgeDimension(buildJudge(63), "boundaryRisk") as ReactElement);
    expect(html).toMatch(/<strong>63<\/strong>/);
    expect(html).not.toContain("未评估");
  });

  it("embeds a judge section into all four dimension cards with the running banner", () => {
    const html = renderPanel({ judgePhase: "running", judgeResult: buildJudge() });
    expect(countOccurrences(html, 'class="rl-judge-section"')).toBe(4);
    expect(countOccurrences(html, 'class="rl-judge-source-tag"')).toBe(4);
    expect(html).toContain("LLM 语义评估进行中");
  });

  it("shows the rule-only report without judge sections when the judge is absent", () => {
    const html = renderPanel({ judgePhase: undefined, judgeResult: undefined });
    expect(html).not.toContain("rl-judge-section");
    expect(html).not.toContain("rl-judge-source-tag");
  });

  it("keeps rule results and explains that they are unaffected when the judge failed", () => {
    const html = renderPanel({ judgePhase: "failed", judgeResult: undefined });
    expect(html).toContain("规则检查结果不受影响");
    expect(html).not.toContain('class="rl-judge-section"');
  });
});
