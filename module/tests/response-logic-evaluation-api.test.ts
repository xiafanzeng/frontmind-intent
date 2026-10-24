import { afterEach, describe, expect, it } from "vitest";
import express, { type Request } from "express";
import http from "node:http";
import { once } from "node:events";
import { createResponseLogicEvaluationRouter } from "../server/response-logic-evaluation-api";
import type {
  ResponseLogicEvaluationStore,
  StoredResponseLogicRuleEvaluation,
} from "../server/response-logic-evaluation-store";
import {
  RULE_EVALUATION_VERSION,
  createResponseLogicRuleEvaluation,
  fingerprintLogic,
} from "../contracts/response-logic-evaluation";
import type { ResponseLogicRecordDto } from "../contracts/response-logic";

class ServiceEntitlementError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

const logic = {
  concern: "用户关注机构资质与真实性，担心选错服务商，希望有可核验的判断标准",
  conclusion: "先核验资质与授权，再对比服务范围与成功案例，最后按适用条件收敛选择。",
  facts: "资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯",
  boundaries: "不使用绝对化承诺；排名表述必须给出样本范围与时间。",
};
const baseRecord: ResponseLogicRecordDto = {
  id: "rec-1",
  questionId: "q1",
  groupId: "g1",
  groupTitle: "行业排名词",
  question: "机构靠谱吗？如何判断服务商资质？",
  intent: "机构可信度与选型判断标准",
  summary: "选型判断标准",
  conversationId: "c1",
  draft: { ...logic, pending: "", references: "", images: [], attachments: [] },
  revision: 3,
  version: 0,
  createdAt: 1,
  updatedAt: 1,
};

function storedFrom(record: ResponseLogicRecordDto): StoredResponseLogicRuleEvaluation {
  return {
    id: "eval-1",
    questionId: record.questionId,
    recordRevision: record.revision,
    confirmedVersion: record.confirmed?.version ?? null,
    sourceFingerprint: fingerprintLogic(logic),
    ruleVersion: RULE_EVALUATION_VERSION,
    evaluation: createResponseLogicRuleEvaluation({
      questionId: record.questionId,
      question: record.question,
      intent: record.intent,
      version: record.confirmed?.version ?? null,
      revision: record.revision,
      logic,
    }),
    createdAt: new Date(),
  };
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

async function makeApp(options: {
  authenticated?: boolean;
  configured?: boolean;
  record?: ResponseLogicRecordDto | null;
  store?: ResponseLogicEvaluationStore;
  capabilityError?: boolean;
}) {
  const configuredQuestion = {
    questionId: "q1",
    groupId: "g1",
    groupTitle: "行业排名词",
    question: baseRecord.question,
    intent: baseRecord.intent,
    summary: "选型判断标准",
    writeScope: { revision: 9, contractId: null, quotaPeriodId: "p1" },
  };
  const core = {
    enterpriseWorkspaceUserId: (id: number) => id,
    assertServiceCapability: async () => {
      if (options.capabilityError) {
        throw new ServiceEntitlementError("SERVICE_ENTITLEMENT_REQUIRED", "该服务需要开通后使用", 403);
      }
    },
    ServiceEntitlementError,
    sendAiBillingError: (() => false) as unknown as (...args: unknown[]) => boolean,
    getDashboardQuestion: async () =>
      options.configured === false ? null : configuredQuestion,
    getResponseLogicEntry: async () =>
      options.record === undefined ? baseRecord : options.record,
    evaluationStore:
      options.store ??
      ({
        save: async () => ({ available: true, value: true }),
        getLatest: async () => ({ available: true, value: null }),
      } as ResponseLogicEvaluationStore),
  };
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (options.authenticated !== false) {
      (request as Request & { frontmindUser?: { id: number } }).frontmindUser = { id: 7 };
    }
    next();
  });
  app.use("/api/response-logic/evaluation", createResponseLogicEvaluationRouter(core));
  const server = http.createServer(app);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function postJson(url: string, body: unknown) {
  return fetch(`${url}/api/response-logic/evaluation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getLatest(url: string) {
  return fetch(`${url}/api/response-logic/evaluation/latest?questionId=q1`);
}

describe("response logic evaluation API", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const url = await makeApp({ authenticated: false });
    const response = await postJson(url, { questionId: "q1" });
    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an invalid body with 400", async () => {
    const url = await makeApp({});
    const response = await postJson(url, {});
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("INVALID_RESPONSE_LOGIC_EVALUATION_INPUT");
  });

  it("returns 422 when the question is not configured", async () => {
    const url = await makeApp({ configured: false });
    const response = await postJson(url, { questionId: "q1" });
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED");
  });

  it("returns 404 when no response-logic record exists", async () => {
    const url = await makeApp({ record: null });
    const response = await postJson(url, { questionId: "q1" });
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESPONSE_LOGIC_RECORD_MISSING");
  });

  it("maps capability errors to their status code", async () => {
    const url = await makeApp({ capabilityError: true });
    const response = await postJson(url, { questionId: "q1" });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error.code).toBe("SERVICE_ENTITLEMENT_REQUIRED");
  });

  it("detects a revision conflict before evaluating", async () => {
    const url = await makeApp({});
    const response = await postJson(url, { questionId: "q1", expectedRevision: 9 });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESPONSE_LOGIC_REVISION_CONFLICT");
    expect(payload.error.actualRevision).toBe(3);
  });

  it("evaluates the authoritative record and reports a persisted result", async () => {
    const saved: unknown[] = [];
    const url = await makeApp({
      store: {
        save: async (input) => {
          saved.push(input);
          return { available: true, value: true };
        },
        getLatest: async () => ({ available: true, value: null }),
      },
    });
    const response = await postJson(url, { questionId: "q1", expectedRevision: 3 });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe("completed");
    expect(payload.persisted).toBe(true);
    expect(payload.ruleVersion).toBe(RULE_EVALUATION_VERSION);
    expect(payload.recordRevision).toBe(3);
    expect(payload.confirmedVersion).toBe(null);
    expect(Object.keys(payload.evaluation.dimensions)).toEqual([
      "relevance",
      "completeness",
      "actionability",
      "boundaryRisk",
    ]);
    expect(payload.evaluation.sourceFingerprint).toBe(fingerprintLogic(logic));
    expect(payload.evaluation.kind).toBe("rule-evaluation");
    expect(saved).toHaveLength(1);
  });

  it("still returns the computed evaluation when persistence is not deployed yet", async () => {
    const url = await makeApp({
      store: {
        save: async () => ({ available: false }),
        getLatest: async () => ({ available: false }),
      },
    });
    const response = await postJson(url, { questionId: "q1" });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.persisted).toBe(false);
    expect(payload.evaluation.dimensions.completeness.score).toBeGreaterThanOrEqual(0);
  });

  it("returns 500 when the store fails with a real database error", async () => {
    const url = await makeApp({
      store: {
        save: async () => {
          throw new Error("connection lost");
        },
        getLatest: async () => ({ available: true, value: null }),
      },
    });
    const response = await postJson(url, { questionId: "q1" });
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESPONSE_LOGIC_EVALUATION_STORE_FAILED");
  });

  it("returns 404 for latest when nothing is stored", async () => {
    const url = await makeApp({});
    const response = await getLatest(url);
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESPONSE_LOGIC_EVALUATION_NOT_FOUND");
  });

  it("returns 503 for latest while the table migration is not deployed", async () => {
    const url = await makeApp({
      store: {
        save: async () => ({ available: true, value: true }),
        getLatest: async () => ({ available: false }),
      },
    });
    const response = await getLatest(url);
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe("RESPONSE_LOGIC_EVALUATION_PERSISTENCE_UNAVAILABLE");
  });

  it("serves a fresh stored evaluation with stale=false", async () => {
    const url = await makeApp({
      store: {
        save: async () => ({ available: true, value: true }),
        getLatest: async () => ({ available: true, value: storedFrom(baseRecord) }),
      },
    });
    const response = await getLatest(url);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stale).toBe(false);
    expect(payload.evaluation.questionId).toBe("q1");
    expect(payload.ruleVersion).toBe(RULE_EVALUATION_VERSION);
  });

  it("marks a stored evaluation stale when the draft content changed", async () => {
    const changedRecord: ResponseLogicRecordDto = {
      ...baseRecord,
      draft: {
        ...baseRecord.draft,
        conclusion: baseRecord.draft.conclusion + "补充：先核对授权范围再签合同。",
      },
    };
    const url = await makeApp({
      record: changedRecord,
      store: {
        save: async () => ({ available: true, value: true }),
        getLatest: async () => ({ available: true, value: storedFrom(baseRecord) }),
      },
    });
    const response = await getLatest(url);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stale).toBe(true);
    expect(payload.recordRevision).toBe(3);
  });
});
