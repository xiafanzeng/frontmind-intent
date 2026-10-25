import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  optimizationContextKey,
  startOptimizationGeneration,
  pollOptimizationTask,
  OptimizationRequestError,
} from "../client/response-logic-optimization-client.js";
import { configureIntentWorkspaceHost } from "../client/runtime-host";
import { optimizationOutputSchema, type OptimizationOutput } from "../contracts/response-logic-optimization.js";
import { buildAdoptionPatch, ResponseLogicOptimizationWorkflow } from "../client/response-logic/optimization-workflow.js";
import { initialOptimizationLifecycleState } from "../client/use-optimization-generation.js";
import type { LogicSections } from "../contracts/response-logic-evaluation.js";

/* ------------------------------------------------------------------ */
/* Client data access                                                  */
/* ------------------------------------------------------------------ */

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

const startResponse = () => jsonResponse(200, {
  taskId: "opt-task-001", status: "running", recordRevision: 5,
  sourceFingerprint: "fp", judgeTaskId: "judge-1", knowledgeFingerprint: "none",
});

const envelope = (optimization: unknown) => jsonResponse(200, {
  status: "completed", optimizerVersion: "1", recordRevision: 5,
  sourceFingerprint: "fp", judgeTaskId: "judge-1", knowledgeFingerprint: "none",
  evaluatedAt: "2026-10-25T00:00:00.000Z", optimization,
});

describe("optimization client", () => {
  it("starts an optimization task passing only identifiers (questionId/revision/judgeTaskId)", async () => {
    const { calls } = installFetch([startResponse]);
    const result = await startOptimizationGeneration({ questionId: "q1", expectedRevision: 5, judgeTaskId: "judge-1" });
    expect(result.taskId).toBe("opt-task-001");
    const start = calls[0]!;
    expect(start.url).toBe("/api/response-logic/optimization");
    expect(JSON.parse(String(start.init?.body))).toEqual({
      questionId: "q1", expectedRevision: 5, judgeTaskId: "judge-1",
    });
  });

  it("omits expectedRevision when not positive", async () => {
    const { calls } = installFetch([startResponse]);
    await startOptimizationGeneration({ questionId: "q1", judgeTaskId: "judge-1" });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ questionId: "q1", judgeTaskId: "judge-1" });
  });

  it("polls status with the binding query and parses the completed envelope", async () => {
    const valid = validOptimization();
    const { calls } = installFetch([
      () => jsonResponse(202, { status: "running", taskId: "opt-task-001" }),
      () => envelope(valid),
    ]);
    const running = await pollOptimizationTask({ questionId: "q1", expectedRevision: 5, judgeTaskId: "judge-1", taskId: "opt-task-001" });
    expect(running.status).toBe("running");
    const completed = await pollOptimizationTask({ questionId: "q1", expectedRevision: 5, judgeTaskId: "judge-1", taskId: "opt-task-001" });
    expect(completed.status).toBe("completed");
    if (completed.status === "completed") {
      expect(completed.result.optimization.optimizedDraft.facts).toContain("来源标记");
    }
    expect(calls[1]!.url).toContain("judgeTaskId=judge-1");
    expect(calls[1]!.url).toContain("expectedRevision=5");
  });

  it("maps server error codes and rejects invalid envelopes", async () => {
    installFetch([() => jsonResponse(422, { error: { code: "OPTIMIZATION_JUDGE_NOT_COMPLETED", message: "评估未完成" } })]);
    await expect(startOptimizationGeneration({ questionId: "q1", expectedRevision: 5, judgeTaskId: "judge-1" }))
      .rejects.toThrow(OptimizationRequestError);
    installFetch([() => envelope({ kind: "wrong" })]);
    await expect(pollOptimizationTask({ questionId: "q1", expectedRevision: 5, judgeTaskId: "judge-1", taskId: "t" }))
      .rejects.toThrow(/传输协议校验|未知状态|invalid/i);
  });

  it("binds context keys per question, revision, fingerprint and judge task", () => {
    const keys = [
      optimizationContextKey("q1", 5, "fp", "j1"),
      optimizationContextKey("q2", 5, "fp", "j1"),
      optimizationContextKey("q1", 6, "fp", "j1"),
      optimizationContextKey("q1", 5, "fp2", "j1"),
      optimizationContextKey("q1", 5, "fp", "j2"),
    ];
    expect(new Set(keys).size).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* Adoption decision (pure)                                            */
/* ------------------------------------------------------------------ */

const logic: LogicSections = {
  concern: "关心原文", conclusion: "结论原文",
  facts: "依据原文", boundaries: "边界原文",
};

function validOptimization(): OptimizationOutput {
  return optimizationOutputSchema.parse({
    kind: "judge-optimization",
    summary: "补充来源绑定与适用前提。",
    optimizedDraft: {
      concern: "关心原文", conclusion: "结论原文（更直接）",
      facts: "依据原文\n来源标记：每条事实标注来源", boundaries: "边界原文\n效果表述注明适用前提。",
    },
    changes: [
      { field: "conclusion", summary: "直接回应问题主语", evidence: [{ source: "draft", excerpt: "结论原文", supports: "保留原意并前置" }] },
      { field: "facts", summary: "补来源标记", evidence: [] },
      { field: "boundaries", summary: "效果表述加前提", evidence: [] },
    ],
  });
}

describe("buildAdoptionPatch", () => {
  it("adopts only the selected sections with the user-edited content", () => {
    const result = validOptimization();
    const edited = { ...result.optimizedDraft, facts: "用户手工改写后的依据" };
    const patch = buildAdoptionPatch(result, { concern: true, conclusion: false, facts: true, boundaries: false }, edited);
    // Unselected sections must not be included; selected use edited text.
    expect(patch).toEqual({ concern: "关心原文", facts: "用户手工改写后的依据" });
    expect(patch).not.toHaveProperty("conclusion");
    expect(patch).not.toHaveProperty("boundaries");
  });

  it("selecting nothing yields an empty patch (no overwrite)", () => {
    const result = validOptimization();
    const patch = buildAdoptionPatch(result, { concern: false, conclusion: false, facts: false, boundaries: false }, result.optimizedDraft);
    expect(patch).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/* Workflow rendering                                                  */
/* ------------------------------------------------------------------ */

const optimizationFlow = (state: typeof initialOptimizationLifecycleState, judgeTaskId = "judge-1") =>
  renderToStaticMarkup(createElement(ResponseLogicOptimizationWorkflow, {
    question: "如何管理手工输入的测试问题？",
    intent: "验收流程管理",
    logic,
    judgeTaskId,
    optimization: { state, start: () => Promise.resolve(), reset: () => {} },
    onAdopt: () => {},
    onBack: () => {},
  }));

describe("optimization workflow rendering", () => {
  it("blocks generation without a completed judge task and explains why", () => {
    const html = optimizationFlow(initialOptimizationLifecycleState, "");
    expect(html).toContain("尚无可用的评估结果");
    expect(html).toContain("查看四维评估");
    // No primary action button — only the explanatory notice.
    expect(html).not.toContain(">生成优化版本</button>");
  });

  it("offers generation when a judge task is bound", () => {
    const html = optimizationFlow(initialOptimizationLifecycleState);
    expect(html).toContain("生成优化版本");
  });

  it("shows the running state and disables re-triggering", () => {
    const html = optimizationFlow({ ...initialOptimizationLifecycleState, phase: "running", taskId: "t" });
    expect(html).toContain("正在生成优化版本");
    expect(html).toContain("disabled");
  });

  it("shows the real failure with its code and retry/discard entries", () => {
    const html = optimizationFlow({
      ...initialOptimizationLifecycleState, phase: "failed",
      error: "Judge 结果与当前应答逻辑不一致", errorCode: "OPTIMIZATION_JUDGE_CONTEXT_MISMATCH",
    });
    expect(html).toContain("优化未完成");
    expect(html).toContain("OPTIMIZATION_JUDGE_CONTEXT_MISMATCH");
    expect(html).toContain("重新生成");
    expect(html).toContain("放弃本次优化");
  });

  it("renders the completed candidate strictly from the model output", () => {
    const result = validOptimization();
    const html = optimizationFlow({ ...initialOptimizationLifecycleState, phase: "completed", result, taskId: "t" });
    // summary, four sections with before/after, change reasons and evidence
    expect(html).toContain("补充来源绑定与适用前提");
    expect(html).toContain("关心原文");
    expect(html).toContain("结论原文（更直接）");
    expect(html).toContain("来源标记：每条事实标注来源");
    expect(html).toContain("修改原因");
    expect(html).toContain("直接回应问题主语");
    expect(html).toContain("「结论原文」");
    expect(html).toContain("草稿原文");
    expect(html).toContain("采用选中项到草稿");
    // candidate provenance is stated; no auto-publish claims
    expect(html).toContain("未写入正式内容");
    expect(html).toContain("不会自动发布");
    // no demo/heuristic artifacts
    expect(html).not.toContain("决策场景：");
    expect(html).not.toContain("在意点：");
  });

  it("renders empty evidence lists as no evidence (never fabricates)", () => {
    const result = validOptimization();
    const html = optimizationFlow({ ...initialOptimizationLifecycleState, phase: "completed", result, taskId: "t" });
    // facts change has empty evidence → only its reason appears, no fake excerpt
    expect(html).toContain("补来源标记");
    expect((html.match(/<p class="rl-judge-evidence">/g) || []).length).toBe(1);
  });
});
