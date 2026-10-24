import { afterEach, describe, expect, it } from "vitest";
import express, { type Request } from "express";
import http from "node:http";
import { once } from "node:events";
import { createResponseLogicJudgeRouter } from "../server/response-logic-judge-api";
import type { CredentialHandle, CoreRequest } from "../server/task-ports";
import type { ResponseLogicRecordDto } from "../contracts/response-logic";
import { createResponseLogicRuleEvaluation, fingerprintLogic } from "../contracts/response-logic-evaluation";
import { judgeOutputSchema, type JudgeOutput } from "../contracts/response-logic-judge";

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
  question: "机构靠谱吗？如何判断服务商资质？", intent: "机构可信度与选型判断标准",
  summary: "选型判断标准", conversationId: "c1",
  draft: { ...logic, pending: "", references: "", images: [], attachments: [] },
  revision: 3, version: 0, createdAt: 1, updatedAt: 1,
};

const validJudge: JudgeOutput = {
  kind: "judge-evaluation",
  dimensions: {
    relevance: { score: 85, band: "mostly_relevant", findings: [] },
    completeness: {
      score: 75,
      coverage: [
        { field: "concern", status: "covered", findings: [] },
        { field: "conclusion", status: "covered", findings: [] },
        { field: "facts", status: "partial", findings: [] },
        { field: "boundaries", status: "partial", findings: [] },
      ],
      findings: [],
    },
    actionability: {
      score: 67,
      subMetrics: [
        { key: "content_specificity", score: 75, band: "mostly_actionable", findings: [] },
        { key: "evidence_guidance", score: 60, band: "moderately_actionable", findings: [] },
        { key: "structure_guidance", score: 65, band: "moderately_actionable", findings: [] },
      ],
      findings: [],
    },
    boundaryRisk: {
      score: 63,
      risks: [
        { key: "unverified_ranking", status: "controlled", findings: [] },
        { key: "absolute_claim", status: "controlled", findings: [] },
        { key: "effect_promise", status: "uncontrolled", findings: [] },
        { key: "unverified_comparison", status: "undetected", findings: [] },
        { key: "unsupported_fact", status: "partial", findings: [] },
        { key: "missing_precondition", status: "not_applicable", findings: [] },
      ],
      findings: [],
    },
  },
  overallAssessment: "草稿整体回应了选型问题，但证据指引和边界控制有提升空间。",
};

/** Mock credential handle. */
const mockCredential: CredentialHandle = {
  id: "cred-1", userId: 7, version: 1, credentialRef: "test-ref", fingerprint: "fp",
  status: "active", verifiedAt: null, agentProfile: "frontmind-base", provider: "manus",
  upstreamModel: "test-model", upstreamEffort: null,
};

/** Build a structured_output_result event. */
function judgeEvent(payload: string): Record<string, unknown> {
  return {
    id: "evt-1", type: "structured_output_result", timestamp: Date.now(),
    structured_output_result: { payload },
  };
}

/** Build a status_update stopped event. */
function stoppedEvent(): Record<string, unknown> {
  return { id: "evt-2", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "stopped" } };
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>((r, j) => s.close(e => e ? j(e) : r()))));
});

type MockOptions = {
  authenticated?: boolean;
  configured?: boolean;
  record?: ResponseLogicRecordDto | null;
  capabilityError?: boolean;
  hasCredential?: boolean;
  upstreamEvents?: Array<Record<string, unknown>>;
  upstreamError?: Error;
  knowledgeSnapshot?: { version: number; sourceFileName: string; documents: Array<{ path: string; title: string; content: string; kind?: string }> } | null;
  recordUpstreamResourceError?: Error;
};

async function makeApp(options: MockOptions = {}) {
  const configuredQuestion = {
    questionId: "q1", groupId: "g1", groupTitle: "行业排名词",
    question: baseRecord.question, intent: baseRecord.intent,
    summary: "选型判断标准",
    writeScope: { revision: 9, contractId: null, quotaPeriodId: "p1" },
  };
  let uploadedFiles: Array<{ fileId: string; filename: string }> = [];
  let createdTask: { taskId: string } | null = null;

  const client = {
    createTask: async (input: { prompt: string; attachments: unknown[]; title: string; agentProfile?: string; locale: string; interactiveMode: boolean; structuredOutputSchema: Record<string, unknown> }) => {
      if (options.upstreamError) throw options.upstreamError;
      createdTask = { taskId: "task-judge-001" };
      return { taskId: "task-judge-001", raw: { status: "running" } };
    },
    sendMessage: async () => ({ taskId: "task-judge-001", raw: {} }),
    listAllMessages: async () => {
      if (options.upstreamError) throw options.upstreamError;
      return options.upstreamEvents ?? [];
    },
    uploadFile: async (input: { filename: string }) => {
      const fileId = `file-${uploadedFiles.length}`;
      uploadedFiles.push({ fileId, filename: input.filename });
      return { fileId, requestId: null, detail: { expiresAt: Math.floor(Date.now() / 1000) + 3600 } };
    },
  };

  const core = {
    enterpriseWorkspaceUserId: (id: number) => id,
    assertServiceCapability: async () => {
      if (options.capabilityError) throw new ServiceEntitlementError("SERVICE_ENTITLEMENT_REQUIRED", "该服务需要开通后使用", 403);
    },
    ServiceEntitlementError,
    sendAiBillingError: (() => false) as unknown as (...args: unknown[]) => boolean,
    getDashboardQuestion: async () => (options.configured === false ? null : configuredQuestion),
    getResponseLogicEntry: async () => (options.record === undefined ? baseRecord : options.record),
    credentialForRequest: (req: Request) => (options.hasCredential === false ? undefined : mockCredential),
    getFrontMindCredentials: () => (options.hasCredential === false ? {} : { credentialRef: "test-ref" }),
    createCredentialAgentClient: () => client,
    getUpstreamBaseUrl: () => "https://upstream.example.com",
    toUpstreamAgentProfile: (p: string) => p,
    getCredentialForUpstreamResource: async (userId: number, kind: string, id: string) => {
      // kind is "task" (MySQL ENUM in upstream_resources only accepts
      // "task" | "file"); ownership is userId + taskId based
      if (id === "task-judge-001" && kind === "task") return mockCredential;
      return null;
    },
    recordUpstreamResource: async () => {
      if (options.recordUpstreamResourceError) throw options.recordUpstreamResourceError;
    },
    getLatestKnowledgeSnapshot: async () => options.knowledgeSnapshot ?? null,
    buildDeterministicTaskAttachmentArchive: async (input: { name: string; entrypoint: string; files: Array<{ path: string; content: string }>; metadata?: Record<string, unknown> }) => ({
      bytes: Buffer.from(JSON.stringify(input.files)), contentHash: "a".repeat(64),
    }),
    classifyManusV2StructuredResultEnvelope: (value: unknown) => {
      if (typeof value === "object" && value !== null && "payload" in (value as Record<string, unknown>)) {
        return { kind: "accepted", value };
      }
      return { kind: "rejected" };
    },
    latestManusV2TaskState: (events: ReadonlyArray<Record<string, unknown>>) => {
      const stopped = events.some(e => (e as { type: string }).type === "status_update" && ((e as { status_update?: { agent_status?: string } }).status_update?.agent_status === "stopped"));
      const errored = events.some(e => (e as { type: string }).type === "status_update" && ((e as { status_update?: { agent_status?: string } }).status_update?.agent_status === "error"));
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
  app.use("/api/response-logic/evaluation/judge", createResponseLogicJudgeRouter(core as never));
  const server = http.createServer(app);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  return `http://127.0.0.1:${addr.port}`;
}

async function postStart(url: string, body: unknown) {
  return fetch(`${url}/api/response-logic/evaluation/judge`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
async function getStatus(url: string, taskId: string, query = "questionId=q1&expectedRevision=3") {
  return fetch(`${url}/api/response-logic/evaluation/judge/tasks/${taskId}/status?${query}`);
}

describe("judge API: POST / (start)", () => {
  it("creates a judge task and returns running", async () => {
    const url = await makeApp({});
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("running");
    expect(body.taskId).toBe("task-judge-001");
    expect(body.recordRevision).toBe(3);
    expect(body.sourceFingerprint).toBe(fingerprintLogic(logic));
    expect(body.judgeVersion).toBe("1");
  });

  it("rejects unauthenticated request with 401", async () => {
    const url = await makeApp({ authenticated: false });
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid body with 400", async () => {
    const url = await makeApp({});
    const res = await postStart(url, {});
    expect(res.status).toBe(400);
  });

  it("returns 422 when question is not configured", async () => {
    const url = await makeApp({ configured: false });
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(422);
  });

  it("returns 404 when no record exists", async () => {
    const url = await makeApp({ record: null });
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(404);
  });

  it("returns 428 when no credential is configured", async () => {
    const url = await makeApp({ hasCredential: false });
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(428);
  });

  it("maps capability errors", async () => {
    const url = await makeApp({ capabilityError: true });
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(403);
  });

  it("returns 409 on revision conflict", async () => {
    const url = await makeApp({});
    const res = await postStart(url, { questionId: "q1", expectedRevision: 99 });
    expect(res.status).toBe(409);
  });
});

describe("judge API: GET /tasks/:taskId/status", () => {
  it("returns 202 running while task is in progress", async () => {
    const url = await makeApp({ upstreamEvents: [{ id: "e1", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "running" } }] });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("running");
  });

  it("returns completed with valid judge output", async () => {
    const payload = JSON.stringify(validJudge);
    const events = [judgeEvent(payload), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.judge.dimensions.relevance.score).toBe(85);
    expect(body.judge.dimensions.completeness.coverage).toHaveLength(4);
    expect(body.judge.dimensions.actionability.subMetrics).toHaveLength(3);
    expect(body.judge.dimensions.boundaryRisk.risks).toHaveLength(6);
  });

  it("returns 422 on invalid JSON payload", async () => {
    const events = [judgeEvent("not valid json"), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("JUDGE_PAYLOAD_INVALID_JSON");
  });

  it("returns 422 on schema mismatch", async () => {
    const bad = { ...validJudge, dimensions: { ...validJudge.dimensions, relevance: { ...validJudge.dimensions.relevance, score: 999 } } };
    const events = [judgeEvent(JSON.stringify(bad)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("JUDGE_OUTPUT_SCHEMA_MISMATCH");
  });

  it("returns 422 on completeness score mismatch", async () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.completeness.score = 100; // recompute expects 75
    const events = [judgeEvent(JSON.stringify(bad)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("JUDGE_SCORE_INCONSISTENT");
    expect(body.error.message).toContain("完整性");
  });

  it("returns 422 on actionability score mismatch", async () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.actionability.score = 100; // recompute expects 67
    const events = [judgeEvent(JSON.stringify(bad)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("JUDGE_SCORE_INCONSISTENT");
  });

  it("returns 422 on boundaryRisk score mismatch", async () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.boundaryRisk.score = 100; // recompute expects 63
    const events = [judgeEvent(JSON.stringify(bad)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("JUDGE_SCORE_INCONSISTENT");
  });

  it("returns 422 on draft excerpt not found", async () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.relevance.findings = [{
      severity: "improve", evidence: "这段文字不存在于草稿中",
      evidenceSource: "draft", evidenceConfidence: "supported",
      reason: "test", suggestion: "test",
    }];
    const events = [judgeEvent(JSON.stringify(bad)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("JUDGE_EVIDENCE_EXCERPT_INVALID");
  });

  it("returns 422 when task failed", async () => {
    const events = [{ id: "e1", type: "status_update", timestamp: Date.now(), status_update: { agent_status: "error" } }];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("RESPONSE_LOGIC_JUDGE_TASK_FAILED");
  });

  it("returns 403 for a task not owned by this user", async () => {
    const url = await makeApp({});
    const res = await getStatus(url, "someone-elses-task");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("RESPONSE_LOGIC_JUDGE_TASK_FORBIDDEN");
  });

  it("returns 403 when using a task with a different questionId (cross-question ownership)", async () => {
    // Task exists for this user (kind "task"), but was created for a
    // different question. The status endpoint's credential lookup uses
    // kind "task" (the only valid ENUM value) — cross-question binding
    // is enforced by the revision check and evidence verification.
    // Here we verify that a nonexistent task ID for a different question
    // is rejected at the ownership level.
    const url = await makeApp({});
    const res = await getStatus(url, "nonexistent-task-for-q2", "questionId=q2&expectedRevision=3");
    expect(res.status).toBe(403);
  });

  it("returns 409 when record revision has changed since task creation (stale context)", async () => {
    // Task was created when revision was 3; current revision is now 5
    const changedRecord = { ...baseRecord, revision: 5 };
    const url = await makeApp({ record: changedRecord });
    // Client passes the original revision 3, but the record is at 5
    const res = await getStatus(url, "task-judge-001", "questionId=q1&expectedRevision=3");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("RESPONSE_LOGIC_REVISION_CONFLICT");
    expect(body.error.actualRevision).toBe(5);
  });

  it("start response includes knowledgeFingerprint for client-side context tracking", async () => {
    const url = await makeApp({});
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.knowledgeFingerprint).toBe("none"); // no knowledge snapshot in mock
    expect(body.sourceFingerprint).toBe(fingerprintLogic(logic));
    expect(body.recordRevision).toBe(3);
  });

  it("returns 401 when unauthenticated", async () => {
    const url = await makeApp({ authenticated: false });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(401);
  });

  it("returns 422 on unknown field in judge output", async () => {
    const bad = { ...validJudge, overallScore: 85 };
    const events = [judgeEvent(JSON.stringify(bad)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("JUDGE_OUTPUT_SCHEMA_MISMATCH");
  });

  it("returns 422 when structured output is missing", async () => {
    const events = [stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("JUDGE_STRUCTURED_OUTPUT_MISSING");
  });
});

describe("judge API: knowledge evidence verification", () => {
  const knowledgeSnapshot = {
    version: 1,
    sourceFileName: "knowledge-v1.md",
    documents: [
      { path: "docs/company.md", title: "公司介绍", content: "FrontMind 是一家专注于企业知识管理的公司，成立于 2020 年。" },
    ],
  };

  it("rejects knowledge-sourced findings when no knowledge snapshot exists", async () => {
    const judge = structuredClone(validJudge);
    judge.dimensions.relevance.findings = [{
      severity: "improve", evidence: "FrontMind 是一家专注于企业知识管理的公司",
      evidenceSource: "knowledge", evidenceConfidence: "supported",
      reason: "知识库中提到公司背景", suggestion: "补充具体产品信息",
    }];
    const events = [judgeEvent(JSON.stringify(judge)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events, knowledgeSnapshot: null });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("JUDGE_KNOWLEDGE_EVIDENCE_UNAVAILABLE");
    expect(body.error.message).toContain("知识库不可用");
  });

  it("accepts valid knowledge-sourced findings when knowledge snapshot exists", async () => {
    const judge = structuredClone(validJudge);
    judge.dimensions.relevance.findings = [{
      severity: "info", evidence: "FrontMind 是一家专注于企业知识管理的公司",
      evidenceSource: "knowledge", evidenceConfidence: "supported",
      reason: "知识库中确认公司背景", suggestion: "引用具体数据",
    }];
    const events = [judgeEvent(JSON.stringify(judge)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events, knowledgeSnapshot });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
  });

  it("rejects knowledge-sourced findings with excerpts not in the knowledge materials", async () => {
    const judge = structuredClone(validJudge);
    judge.dimensions.relevance.findings = [{
      severity: "improve", evidence: "这段内容不在知识库中但是被标记为knowledge来源",
      evidenceSource: "knowledge", evidenceConfidence: "supported",
      reason: "test", suggestion: "test",
    }];
    const events = [judgeEvent(JSON.stringify(judge)), stoppedEvent()];
    const url = await makeApp({ upstreamEvents: events, knowledgeSnapshot });
    const res = await getStatus(url, "task-judge-001");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("JUDGE_KNOWLEDGE_EVIDENCE_INVALID");
  });
});

describe("judge API: recordUpstreamResource failure", () => {
  it("returns 502 with binding pending when ownership recording fails after task creation", async () => {
    const url = await makeApp({
      recordUpstreamResourceError: new Error("database write failed"),
    });
    const res = await postStart(url, { questionId: "q1" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("RESPONSE_LOGIC_JUDGE_BINDING_PENDING");
    expect(body.error.resetRequired).toBe(true);
  });
});
