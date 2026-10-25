import { afterEach, describe, expect, it } from "vitest";
import express, { type Request } from "express";
import http from "node:http";
import { once } from "node:events";
import { createResponseLogicOptimizationRouter, optimizerSkillDirectoryCandidates } from "../server/response-logic-optimization-api";
import type { CoreRequest, CredentialHandle } from "../server/task-ports";
import type { ResponseLogicRecordDto } from "../contracts/response-logic";
import { fingerprintLogic } from "../contracts/response-logic-evaluation";
import { judgeOutputSchema, type JudgeOutput } from "../contracts/response-logic-judge";
import { optimizationOutputSchema, verifyOptimizationEvidence, verifyOptimizedDraftStructure, type OptimizationOutput } from "../contracts/response-logic-optimization";

class ServiceEntitlementError extends Error {
  constructor(public code: string, message: string, public statusCode: number) { super(message); }
}

const logic = {
  concern: "用户关注机构资质与真实性，担心选错服务商，希望有可核验的判断标准",
  conclusion: "先核验资质与授权，再对比服务范围与成功案例，最后按适用条件收敛选择。",
  facts: "资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯",
  boundaries: "不使用绝对化承诺；排名表述必须给出样本范围与时间。",
};

const baseRecord: ResponseLogicRecordDto = {
  id: "rec-1", questionId: "q1", groupId: "g1", groupTitle: "行业排名词",
  question: "机构靠谱吗？如何判断服务商资质？", intent: "机构可信度与选型判断标准", summary: "选型判断标准",
  revision: 5, version: 0, createdAt: 1, updatedAt: 1,
  draft: { concern: logic.concern, conclusion: logic.conclusion, facts: logic.facts, boundaries: logic.boundaries, pending: "", references: "", attachments: [], images: [] },
} as unknown as ResponseLogicRecordDto;

const mockCredential: CredentialHandle = {
  id: "cred-1", userId: 7, version: 1, credentialRef: "test-ref", fingerprint: "fp",
  status: "active", verifiedAt: null, agentProfile: "frontmind-base", provider: "manus",
  upstreamModel: "test-model", upstreamEffort: null,
};

const validJudge: JudgeOutput = judgeOutputSchema.parse({
  kind: "judge-evaluation",
  dimensions: {
    relevance: { score: 85, band: "mostly_relevant", findings: [
      { severity: "improve", evidence: "先核验资质与授权", evidenceSource: "draft", evidenceConfidence: "supported", reason: "结论首句已回应问题但可更直接", suggestion: "保留核验优先的顺序并明确判断标准" },
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
    boundaryRisk: { score: 63, risks: [
      { key: "unverified_ranking", status: "controlled", findings: [] },
      { key: "absolute_claim", status: "controlled", findings: [] },
      { key: "effect_promise", status: "uncontrolled", findings: [] },
      { key: "unverified_comparison", status: "undetected", findings: [] },
      { key: "unsupported_fact", status: "partial", findings: [] },
      { key: "missing_precondition", status: "not_applicable", findings: [] },
    ], findings: [] },
  },
  overallAssessment: "整体回应了选型问题，证据指引和边界控制有提升空间。",
});

const judgeEvent = (payload: string) => ({
  id: "evt-judge", type: "structured_output_result", timestamp: Date.now(),
  structured_output_result: { success: true, value: { payload } },
});
const judgeStopped = { id: "evt-j2", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "stopped" } };
const judgeRunning = { id: "evt-j3", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "running" } };
const judgeErrored = { id: "evt-j4", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "error" } };

const validOptimization: OptimizationOutput = optimizationOutputSchema.parse({
  kind: "judge-optimization",
  summary: "针对 evidence_guidance 与 effect_promise 两项发现补充来源绑定和效果表述前提。",
  optimizedDraft: {
    concern: logic.concern,
    conclusion: logic.conclusion,
    facts: "资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯\n来源标记：以上每条事实须标注知识库文档/官网/项目记录来源；无法核验的表述不作为依据",
    boundaries: "不使用绝对化承诺；排名表述必须给出样本范围与时间；效果类表述必须注明适用前提。",
  },
  changes: [
    { field: "facts", summary: "evidence_guidance 60：来源绑定不具体 → 为每条事实补充来源标记与缺据降级规则", evidence: [
      { source: "draft", excerpt: "资质证书：见官网公示", supports: "保留并强化的原有事实条目" },
    ] },
    { field: "boundaries", summary: "effect_promise 未控制 → 增加效果类表述必须注明适用前提的边界", evidence: [] },
  ],
});

const optimizationEvent = (payload: string) => ({
  id: "evt-opt", type: "structured_output_result", timestamp: Date.now(),
  structured_output_result: { success: true, value: { payload } },
});
const optimizationStopped = { id: "evt-o2", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "stopped" } };

const JUDGE_TASK_ID = "judge-task-001";
const OPT_TASK_ID = "task-opt-001";

type MockOptions = {
  authenticated?: boolean;
  record?: ResponseLogicRecordDto | null;
  hasCredential?: boolean;
  judgeEvents?: Array<Record<string, unknown>>;
  optimizerEvents?: Array<Record<string, unknown>>;
  knowledgeSnapshot?: { version: number; sourceFileName: string; documents: Array<{ path: string; title: string; content: string; kind?: string }> } | null;
  judgeTaskOwned?: boolean;
};

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>((r, j) => s.close(e => e ? j(e) : r()))));
});

const createdTasks: Array<{ prompt: string }> = [];

async function makeApp(options: MockOptions = {}) {
  const configuredQuestion = {
    questionId: "q1", groupId: "g1", groupTitle: "行业排名词",
    question: baseRecord.question, intent: baseRecord.intent,
    summary: "选型判断标准",
    writeScope: { revision: 9, contractId: null, quotaPeriodId: "p1" },
  };
  const archives: Array<{ name: string; entrypoint: string; files: Array<{ path: string; content: string }> }> = [];

  const client = {
    createTask: async (input: { prompt: string }) => {
      createdTasks.push({ prompt: input.prompt });
      return { taskId: OPT_TASK_ID, raw: { status: "running" } };
    },
    sendMessage: async () => ({ taskId: OPT_TASK_ID, raw: {} }),
    listAllMessages: async (input: { taskId: string }) => {
      if (input.taskId === JUDGE_TASK_ID) return options.judgeEvents ?? [judgeEvent(JSON.stringify(validJudge)), judgeStopped];
      return options.optimizerEvents ?? [];
    },
    uploadFile: async () => ({ fileId: "file-1", requestId: null, detail: { expiresAt: 0 } }),
  };

  const core = {
    enterpriseWorkspaceUserId: (id: number) => id,
    assertServiceCapability: async () => {},
    ServiceEntitlementError,
    sendAiBillingError: (() => false) as unknown as (...args: unknown[]) => boolean,
    getDashboardQuestion: async () => configuredQuestion,
    getResponseLogicEntry: async () => (options.record === undefined ? baseRecord : options.record),
    credentialForRequest: () => (options.hasCredential === false ? undefined : mockCredential),
    getFrontMindCredentials: () => (options.hasCredential === false ? {} : { credentialRef: "test-ref" }),
    createCredentialAgentClient: () => client,
    getUpstreamBaseUrl: () => "https://upstream.example.com",
    toUpstreamAgentProfile: (p: string) => p,
    getCredentialForUpstreamResource: async (_userId: number, kind: string, id: string) => {
      if (kind === "task" && id === JUDGE_TASK_ID && options.judgeTaskOwned !== false) return mockCredential;
      if (kind === "task" && id === OPT_TASK_ID) return mockCredential;
      return null;
    },
    recordUpstreamResource: async () => {},
    getLatestKnowledgeSnapshot: async () => options.knowledgeSnapshot ?? null,
    buildDeterministicTaskAttachmentArchive: async (input: { name: string; entrypoint: string; files: Array<{ path: string; content: string }>; metadata?: Record<string, unknown> }) => {
      archives.push(input);
      return { bytes: Buffer.from(JSON.stringify(input.files)), contentHash: "a".repeat(64) };
    },
    classifyManusV2StructuredResultEnvelope: (input: unknown) => {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { kind: "missing", code: "STRUCTURED_OUTPUT_MISSING" };
      }
      const result = input as Record<string, unknown>;
      const error = result.error;
      const hasNonemptyError = error !== undefined && error !== null && (typeof error !== "string" || error.trim().length > 0);
      if (result.success === false || hasNonemptyError) return { kind: "rejected", code: "STRUCTURED_OUTPUT_REJECTED" };
      if (result.value === undefined) return { kind: "missing", code: "STRUCTURED_OUTPUT_MISSING" };
      if (result.success !== true) return { kind: "rejected", code: "STRUCTURED_OUTPUT_REJECTED" };
      return { kind: "accepted", value: result.value };
    },
    latestManusV2TaskState: (events: ReadonlyArray<Record<string, unknown>>) => {
      const stopped = events.some(e => e.type === "status_update" && ((e as { status_update?: { agent_status?: string } }).status_update?.agent_status === "stopped"));
      const errored = events.some(e => e.type === "status_update" && ((e as { status_update?: { agent_status?: string } }).status_update?.agent_status === "error"));
      if (errored) return "error";
      if (stopped) return "stopped";
      return "running";
    },
    orderManusV2EventsByProviderRank: (events: ReadonlyArray<Record<string, unknown>>, dir: string) =>
      dir === "newest_first" ? [...events].reverse() : [...events],
    ManusV2ApiError: class extends Error { constructor(public operation: string, public status: number | null, public code: string, public retryable: boolean, public outcomeUnknown: boolean) { super(code); } },
    assertUpstreamPromptBudget: (v: string) => v,
  };

  const app = express();
  app.use(express.json());
  app.use((request, _res, next) => {
    if (options.authenticated !== false) {
      (request as Request & { frontmindUser?: { id: number } }).frontmindUser = { id: 7 };
    }
    next();
  });
  app.use("/api/response-logic/optimization", createResponseLogicOptimizationRouter(core as never));
  const server = http.createServer(app);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  return { url: `http://127.0.0.1:${addr.port}`, archives };
}

const postStart = (url: string, body: unknown, judgeTaskId: string = JUDGE_TASK_ID) =>
  fetch(`${url}/api/response-logic/optimization`, {
    method: "POST", headers: { "content-type": "application/json", Origin: url }, body: JSON.stringify(body ?? { questionId: "q1", expectedRevision: 5, judgeTaskId }),
  });

const getStatus = (url: string, taskId: string, query = `questionId=q1&expectedRevision=5&judgeTaskId=${JUDGE_TASK_ID}`) =>
  fetch(`${url}/api/response-logic/optimization/tasks/${taskId}/status?${query}`);

/* ------------------------------------------------------------------ */
/* Contract verification helpers                                       */
/* ------------------------------------------------------------------ */

describe("optimization contract verification", () => {
  it("accepts a well-formed candidate with verifiable draft evidence", () => {
    expect(verifyOptimizedDraftStructure(validOptimization).ok).toBe(true);
    const result = verifyOptimizationEvidence(validOptimization, logic, null);
    expect(result.invalid).toBe(0);
    expect(result.valid).toBe(1);
  });

  it("rejects unknown fields and missing sections via strict schema", () => {
    const bad = { ...validOptimization, score: 99 } as Record<string, unknown>;
    expect(optimizationOutputSchema.safeParse(bad).success).toBe(false);
    const noDraft = { ...validOptimization, optimizedDraft: { concern: "x" } };
    expect(optimizationOutputSchema.safeParse(noDraft).success).toBe(false);
    const noChanges = { ...validOptimization, changes: [] };
    expect(optimizationOutputSchema.safeParse(noChanges).success).toBe(false);
  });

  it("rejects evidence excerpts absent from the draft or knowledge materials", () => {
    const fabricated = optimizationOutputSchema.parse({
      ...validOptimization,
      changes: [{ field: "facts", summary: "编造证据", evidence: [{ source: "draft", excerpt: "这句话不在草稿里", supports: "无" }] }],
    });
    expect(verifyOptimizationEvidence(fabricated, logic, null).invalid).toBe(1);
    const knowledgeCitation = optimizationOutputSchema.parse({
      ...validOptimization,
      changes: [{ field: "facts", summary: "引用知识", evidence: [{ source: "knowledge", excerpt: "官方口径：一律以合同为准", supports: "知识依据" }] }],
    });
    // knowledge unavailable → ANY knowledge citation is rejected
    expect(verifyOptimizationEvidence(knowledgeCitation, logic, null).invalid).toBe(1);
    // knowledge available but excerpt missing → rejected
    expect(verifyOptimizationEvidence(knowledgeCitation, logic, "知识材料：另有内容").invalid).toBe(1);
    // knowledge available and excerpt present → accepted
    expect(verifyOptimizationEvidence(knowledgeCitation, logic, "官方口径：一律以合同为准").invalid).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* POST / (start): judge binding and never trusting the client         */
/* ------------------------------------------------------------------ */

describe("optimization API: POST / (start)", () => {
  it("starts an optimization task bound to a verified judge diagnosis", async () => {
    const { url, archives } = await makeApp({});
    const res = await postStart(url, undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("running");
    expect(body.taskId).toBe(OPT_TASK_ID);
    expect(body.judgeTaskId).toBe(JUDGE_TASK_ID);
    expect(body.optimizerVersion).toBe("1");
    // turn-input carries the judge output, current draft and NO rule evaluation
    const turnInput = JSON.parse(archives.find(a => a.name === "response-logic-optimization-turn-input")!.files[0]!.content);
    expect(turnInput.judgeEvaluation.judge.dimensions.relevance.score).toBe(85);
    expect(turnInput.judgeEvaluation.judgeTaskId).toBe(JUDGE_TASK_ID);
    expect(turnInput.currentDraft).toEqual(logic);
    expect(JSON.stringify(turnInput)).not.toContain("ruleEvaluation");
    expect(turnInput.outputContract).toEqual(expect.objectContaining({ noScores: true, candidateOnly: true }));
  });

  it("rejects a judge task that does not belong to the account", async () => {
    const { url } = await makeApp({ judgeTaskOwned: false });
    const res = await postStart(url);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_JUDGE_TASK_FORBIDDEN");
  });

  it("refuses to optimize while the judge task is still running (no silent fallback)", async () => {
    const { url } = await makeApp({ judgeEvents: [judgeRunning] });
    const res = await postStart(url);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_JUDGE_NOT_COMPLETED");
  });

  it("refuses to optimize from a failed judge task", async () => {
    const { url } = await makeApp({ judgeEvents: [judgeErrored] });
    const res = await postStart(url);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_JUDGE_FAILED");
  });

  it("refuses to optimize when the judge result cannot be parsed", async () => {
    const { url } = await makeApp({ judgeEvents: [judgeStopped] });
    const res = await postStart(url);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_JUDGE_RESULT_UNAVAILABLE");
  });

  it("rejects a judge result whose draft excerpts do not match the current draft", async () => {
    // The client cannot smuggle a judge result for different content: the
    // re-validated excerpts must exist in the CURRENT four sections.
    const driftedRecord = { ...baseRecord, revision: 6, draft: { ...baseRecord.draft, conclusion: "完全不同的结论", facts: "完全不同的依据", concern: "完全不同的关心", boundaries: "完全不同的边界" } };
    const { url } = await makeApp({ record: driftedRecord });
    const res = await postStart(url, { questionId: "q1", expectedRevision: 6, judgeTaskId: JUDGE_TASK_ID });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_JUDGE_CONTEXT_MISMATCH");
  });

  it("returns 409 on revision conflict", async () => {
    const { url } = await makeApp({});
    const res = await postStart(url, { questionId: "q1", expectedRevision: 99, judgeTaskId: JUDGE_TASK_ID });
    expect(res.status).toBe(409);
  });

  it("is idempotent: identical inputs produce the same operation token", async () => {
    createdTasks.length = 0;
    const { url } = await makeApp({});
    await postStart(url);
    await postStart(url);
    expect(createdTasks).toHaveLength(2);
    const tokens = createdTasks.map(t => t.prompt.match(/OPERATION_CONTRACT=(\{[^}]*\})/)?.[1]);
    expect(tokens[0]).toBe(tokens[1]);
  });
});

/* ------------------------------------------------------------------ */
/* GET /tasks/:taskId/status                                           */
/* ------------------------------------------------------------------ */

describe("optimization API: GET /tasks/:taskId/status", () => {
  it("returns 202 while the optimizer runs", async () => {
    const { url } = await makeApp({ optimizerEvents: [{ id: "e1", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "running" } }] });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("running");
  });

  it("returns completed with the validated candidate", async () => {
    const { url } = await makeApp({ optimizerEvents: [optimizationEvent(JSON.stringify(validOptimization)), optimizationStopped] });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.optimization.optimizedDraft.conclusion).toBe(logic.conclusion);
    expect(body.judgeTaskId).toBe(JUDGE_TASK_ID);
    expect(body.optimization.changes.length).toBeGreaterThan(0);
  });

  it("rejects schema-violating outputs (missing changes / unknown fields)", async () => {
    const bad = { ...validOptimization, changes: [] };
    const { url } = await makeApp({ optimizerEvents: [optimizationEvent(JSON.stringify(bad)), optimizationStopped] });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_OUTPUT_SCHEMA_MISMATCH");
  });

  it("rejects fabricated draft evidence excerpts", async () => {
    const fabricated = optimizationOutputSchema.parse({
      ...validOptimization,
      changes: [{ field: "facts", summary: "改", evidence: [{ source: "draft", excerpt: "草稿中不存在的摘录", supports: "无" }] }],
    });
    const { url } = await makeApp({ optimizerEvents: [optimizationEvent(JSON.stringify(fabricated)), optimizationStopped] });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_EVIDENCE_EXCERPT_INVALID");
  });

  it("rejects knowledge citations when knowledge is unavailable", async () => {
    const cites = optimizationOutputSchema.parse({
      ...validOptimization,
      changes: [{ field: "facts", summary: "引用", evidence: [{ source: "knowledge", excerpt: "官方口径：一律以合同为准", supports: "知识依据" }] }],
    });
    const { url } = await makeApp({ optimizerEvents: [optimizationEvent(JSON.stringify(cites)), optimizationStopped] });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("OPTIMIZATION_KNOWLEDGE_EVIDENCE_UNAVAILABLE");
  });

  it("accepts knowledge citations that exist in the available materials", async () => {
    const cites = optimizationOutputSchema.parse({
      ...validOptimization,
      changes: [{ field: "facts", summary: "引用", evidence: [{ source: "knowledge", excerpt: "官方口径：一律以合同为准", supports: "知识依据" }] }],
    });
    const { url } = await makeApp({
      knowledgeSnapshot: { version: 3, sourceFileName: "k.md", documents: [{ path: "k.md", title: "K", content: "官方口径：一律以合同为准" }] },
      optimizerEvents: [optimizationEvent(JSON.stringify(cites)), optimizationStopped],
    });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(200);
  });

  it("returns 403 for a task owned by another account", async () => {
    const { url } = await makeApp({});
    const res = await getStatus(url, "someone-else-task");
    expect(res.status).toBe(403);
  });

  it("returns 422 when the optimizer task itself failed", async () => {
    const { url } = await makeApp({ optimizerEvents: [{ id: "e1", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "error" } }] });
    const res = await getStatus(url, OPT_TASK_ID);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("RESPONSE_LOGIC_OPTIMIZATION_TASK_FAILED");
  });
});

/* ------------------------------------------------------------------ */
/* Skill directory resolution                                          */
/* ------------------------------------------------------------------ */

describe("optimizer skill directory resolution", () => {
  it("uses the configured path alone when provided", () => {
    expect(optimizerSkillDirectoryCandidates("/srv/skills/response-logic-optimizer.skill"))
      .toEqual(["/srv/skills/response-logic-optimizer.skill"]);
  });
  it("falls back through dev and container layouts when unconfigured", () => {
    const candidates = optimizerSkillDirectoryCandidates(undefined);
    expect(candidates).toHaveLength(4);
    expect(candidates[3].replaceAll("\\", "/")).toMatch(/\/module-build\/module\/workflows\/response-logic-optimizer\.skill$/);
  });
});
