import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  judgeEvaluationReducer,
  judgeStartBlocked,
  initialJudgeLifecycleState,
} from "../client/use-judge-evaluation.js";
import { judgeContextKey } from "../client/response-logic-judge-client.js";
import { judgeOutputSchema, type JudgeOutput } from "../contracts/response-logic-judge.js";
import { ResponseLogicEvaluationPanel } from "../client/response-logic/evaluation-panel.js";
import { renderJudgeDimension } from "../client/response-logic/judge-panel.js";

function buildJudge(boundaryRiskScore: number | null = 63): JudgeOutput {
  return judgeOutputSchema.parse({
    kind: "judge-evaluation",
    dimensions: {
      relevance: { score: 85, band: "mostly_relevant", findings: [
        { severity: "improve", evidence: "先核验资质与授权", evidenceSource: "draft", evidenceConfidence: "supported", reason: "结论首句未直接回应问题主语", suggestion: "在结论首句先给出对问题的直接回答" },
      ] },
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
        { key: "effect_promise", status: "uncontrolled", findings: [
          { severity: "risk", evidence: "", evidenceSource: "inference", evidenceConfidence: "unverifiable", reason: "发现效果承诺但边界未控制", suggestion: "为效果类表述补充适用前提" },
        ] },
        { key: "unverified_comparison", status: "undetected", findings: [] },
        { key: "unsupported_fact", status: "partial", findings: [] },
        { key: "missing_precondition", status: "not_applicable", findings: [] },
      ], findings: [] },
    },
    overallAssessment: "草稿整体回应了选型问题，但证据指引和边界控制有提升空间。",
  });
}

const QUESTION = "如何选择企业服务服务商？";
const INTENT = "选型对比";

const countOccurrences = (html: string, needle: string) => html.split(needle).length - 1;

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

  it("marks poll failures and timeouts as failed", () => {
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
/* Formal report rendering: LLM-only scores, no rule fallback          */
/* ------------------------------------------------------------------ */

describe("formal four-dimension report rendering", () => {
  const renderPanel = (props: Partial<Parameters<typeof ResponseLogicEvaluationPanel>[0]> & { judgePhase: "idle" | "starting" | "running" | "completed" | "failed" }) =>
    renderToStaticMarkup(createElement(ResponseLogicEvaluationPanel, {
      question: QUESTION,
      intent: INTENT,
      judgeResult: null,
      onBack: () => {},
      onOptimize: () => {},
      ...props,
    }));

  it("renders all four dimensions from judge data alone, with no rule content", () => {
    const html = renderPanel({ judgePhase: "completed", judgeResult: buildJudge() });
    expect(countOccurrences(html, 'class="rl-eval-card rl-eval-score-card"')).toBe(4);
    // LLM scores present for scored dimensions (85/75/67) and diagnosis aggregates judge findings
    expect(html).toContain(">85</strong>");
    expect(html).toContain(">67</strong>");
    expect(html).toContain("草稿整体回应了选型问题");
    expect(html).toContain("待改进");
    // No rule-engine content anywhere in the formal report
    expect(html).not.toContain("规则评估");
    expect(html).not.toContain("服务端规则");
  });

  it("renders boundaryRisk score=null as 未评估 instead of a numeric score", () => {
    const html = renderPanel({ judgePhase: "completed", judgeResult: buildJudge(null) });
    expect(html).toContain("未评估");
    expect(html).not.toMatch(/<strong[^>]*>\s*0\s*<small>/);
    const dimension = renderToStaticMarkup(renderJudgeDimension(buildJudge(null), "boundaryRisk") as ReactElement);
    expect(dimension).toContain("未评估");
    expect(dimension).toContain("无可计分的适用风险项");
    expect(dimension).not.toMatch(/<strong>\s*\d+\s*<\/strong>/);
  });

  it("renders a numeric boundaryRisk score normally", () => {
    const dimension = renderToStaticMarkup(renderJudgeDimension(buildJudge(63), "boundaryRisk") as ReactElement);
    expect(dimension).toMatch(/<strong>63<\/strong>/);
  });

  it("shows the running state instead of any partial report", () => {
    const html = renderPanel({ judgePhase: "running" });
    expect(html).toContain("LLM 语义评估进行中");
    expect(countOccurrences(html, 'class="rl-eval-card rl-eval-score-card"')).toBe(1);
    expect(html).not.toContain('role="meter"');
  });

  it("surfaces the real judge error with a retry entry and never falls back to rule scores", () => {
    const html = renderPanel({ judgePhase: "failed", judgeError: "Judge 请求失败 · RESPONSE_LOGIC_JUDGE_FAILED", onRetry: () => {} });
    expect(html).toContain("LLM 语义评估未完成");
    expect(html).toContain("Judge 请求失败 · RESPONSE_LOGIC_JUDGE_FAILED");
    expect(html).toContain("重新发起评估");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("规则评估");
  });

  it("does not depend on any rule-evaluation input: the panel accepts none", () => {
    // Compiling this call with only judge props is the contract; rendering must succeed.
    const html = renderPanel({ judgePhase: "completed", judgeResult: buildJudge() });
    expect(html).toContain(QUESTION);
    expect(html).toContain(INTENT);
  });

  it("renders an idle notice before any evaluation starts", () => {
    const html = renderPanel({ judgePhase: "idle" });
    expect(html).toContain("尚未评估");
    expect(html).not.toContain('role="meter"');
  });
});
