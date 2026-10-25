import { afterEach, describe, expect, it, vi } from "vitest";
import { configureIntentWorkspaceHost } from "../client/runtime-host";
import {
  startJudgeEvaluation,
  pollJudgeTask,
  judgeContextKey,
  JudgeRequestError,
} from "../client/response-logic-judge-client";
import { judgeOutputSchema, type JudgeOutput } from "../contracts/response-logic-judge";

function installFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  configureIntentWorkspaceHost({
    captureRestOperation: (signal?: AbortSignal | null) => ({
      signal: signal ?? new AbortController().signal,
      assertActive() {},
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        const handler = handlers[index];
        index += 1;
        if (!handler) throw new Error(`unexpected call #${index}: ${url}`);
        return handler(url, init);
      },
    }),
  } as unknown as Parameters<typeof configureIntentWorkspaceHost>[0]);
  return { calls };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const startResponse = jsonResponse(200, {
  taskId: "judge-task-001", status: "running", recordRevision: 3,
  sourceFingerprint: "fp-abc", knowledgeFingerprint: "none",
});

const validJudge: JudgeOutput = judgeOutputSchema.parse({
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
    boundaryRisk: { score: 63, risks: [
      { key: "unverified_ranking", status: "controlled", findings: [] },
      { key: "absolute_claim", status: "controlled", findings: [] },
      { key: "effect_promise", status: "uncontrolled", findings: [] },
      { key: "unverified_comparison", status: "undetected", findings: [] },
      { key: "unsupported_fact", status: "partial", findings: [] },
      { key: "missing_precondition", status: "not_applicable", findings: [] },
    ], findings: [] },
  },
  overallAssessment: "整体回应了选型问题。",
});

describe("judge client", () => {
  it("starts a judge task and returns taskId with context", async () => {
    const { calls } = installFetch([() => startResponse]);
    const result = await startJudgeEvaluation({ questionId: "q1", expectedRevision: 3 });
    expect(result.taskId).toBe("judge-task-001");
    expect(result.recordRevision).toBe(3);
    expect(result.sourceFingerprint).toBe("fp-abc");
    expect(calls[0].url).toBe("/api/response-logic/evaluation/judge");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ questionId: "q1", expectedRevision: 3 });
  });

  it("polls running status", async () => {
    installFetch([() => jsonResponse(202, { status: "running", taskId: "judge-task-001" })]);
    const result = await pollJudgeTask({ questionId: "q1", expectedRevision: 3, taskId: "judge-task-001" });
    expect(result.status).toBe("running");
  });

  it("polls completed status and returns validated judge result", async () => {
    installFetch([() => jsonResponse(200, {
      status: "completed", judgeVersion: "1", recordRevision: 3,
      sourceFingerprint: "fp-abc", evaluatedAt: new Date().toISOString(),
      judge: validJudge,
    })]);
    const result = await pollJudgeTask({ questionId: "q1", expectedRevision: 3, taskId: "judge-task-001" });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.result.judge.dimensions.relevance.score).toBe(85);
      expect(result.result.judge.dimensions.boundaryRisk.risks).toHaveLength(6);
    }
  });

  it("propagates 401 as JudgeRequestError", async () => {
    installFetch([() => jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "请先登录" } })]);
    await expect(startJudgeEvaluation({ questionId: "q1" })).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("propagates 409 version conflict", async () => {
    installFetch([() => jsonResponse(409, { error: { code: "RESPONSE_LOGIC_REVISION_CONFLICT", message: "版本已更新" } })]);
    await expect(startJudgeEvaluation({ questionId: "q1", expectedRevision: 99 })).rejects.toMatchObject({ code: "RESPONSE_LOGIC_REVISION_CONFLICT" });
  });

  it("propagates 422 judge task failure", async () => {
    installFetch([() => jsonResponse(422, { error: { code: "RESPONSE_LOGIC_JUDGE_TASK_FAILED", message: "任务失败" } })]);
    await expect(pollJudgeTask({ questionId: "q1", expectedRevision: 3, taskId: "t1" })).rejects.toMatchObject({ code: "RESPONSE_LOGIC_JUDGE_TASK_FAILED" });
  });

  it("propagates transport error", async () => {
    installFetch([() => { throw new TypeError("network down"); }]);
    await expect(startJudgeEvaluation({ questionId: "q1" })).rejects.toMatchObject({ code: "JUDGE_TRANSPORT_FAILED" });
  });

  it("rejects invalid completion payload", async () => {
    installFetch([() => jsonResponse(200, { status: "completed", judge: { invalid: true } })]);
    await expect(pollJudgeTask({ questionId: "q1", expectedRevision: 3, taskId: "t1" })).rejects.toMatchObject({ code: "JUDGE_RESPONSE_INVALID" });
  });
});

describe("judgeContextKey", () => {
  it("produces distinct keys for different contexts", () => {
    const a = judgeContextKey("q1", 3, "fp-a");
    const b = judgeContextKey("q2", 3, "fp-a");
    const c = judgeContextKey("q1", 4, "fp-a");
    const d = judgeContextKey("q1", 3, "fp-b");
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
});
