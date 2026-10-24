import { describe, expect, it } from "vitest";
import { configureIntentWorkspaceHost } from "../client/runtime-host";
import {
  ResponseLogicEvaluationRequestError,
  resolveResponseLogicRuleEvaluation,
} from "../client/response-logic-evaluation-client";
import {
  RULE_EVALUATION_VERSION,
  createResponseLogicRuleEvaluation,
  fingerprintLogic,
  ruleEvaluationSchema,
} from "../contracts/response-logic-evaluation";

const logic = {
  concern: "用户关注机构资质与真实性，担心选错服务商，希望有可核验的判断标准",
  conclusion: "先核验资质与授权，再对比服务范围与成功案例，最后按适用条件收敛选择。",
  facts: "资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯",
  boundaries: "不使用绝对化承诺；排名表述必须给出样本范围与时间。",
};
const evaluation = createResponseLogicRuleEvaluation({
  questionId: "q1",
  question: "机构靠谱吗？如何判断服务商资质？",
  intent: "机构可信度与选型判断标准",
  version: null,
  revision: 3,
  logic,
});
if (!ruleEvaluationSchema.safeParse(evaluation).success) {
  throw new Error("test fixture evaluation must satisfy the wire schema");
}

type Call = { url: string; init?: RequestInit };

function installHostFetch(
  handlers: Array<(call: Call) => Response>,
): { calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  configureIntentWorkspaceHost({
    captureRestOperation: (signal?: AbortSignal | null) => ({
      signal: signal ?? new AbortController().signal,
      assertActive() {},
      fetch: async (input, init) => {
        const call = { url: String(input), init };
        calls.push(call);
        const handler = handlers[index];
        index += 1;
        if (!handler) throw new Error(`unexpected HTTP call #${index}: ${call.url}`);
        return handler(call);
      },
    }),
  } as unknown as Parameters<typeof configureIntentWorkspaceHost>[0]);
  return { calls };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const latestUrl = "/api/response-logic/evaluation/latest?questionId=q1";
const postUrl = "/api/response-logic/evaluation";

const postEnvelope = (persisted: boolean) =>
  jsonResponse(200, {
    status: "completed",
    persisted,
    ruleVersion: RULE_EVALUATION_VERSION,
    recordRevision: 3,
    confirmedVersion: null,
    evaluatedAt: new Date().toISOString(),
    evaluation,
  });

const latestEnvelope = (stale: boolean) =>
  jsonResponse(200, {
    status: "completed",
    stale,
    ruleVersion: RULE_EVALUATION_VERSION,
    recordRevision: 3,
    confirmedVersion: null,
    evaluation,
  });

describe("response logic evaluation client fallback", () => {
  it("falls back to POST when the history store is not deployed (503) and keeps persisted:false", async () => {
    const { calls } = installHostFetch([
      () =>
        jsonResponse(503, {
          error: {
            code: "RESPONSE_LOGIC_EVALUATION_PERSISTENCE_UNAVAILABLE",
            message: "评估结果存储尚未启用（等待数据库迁移），请重新发起评估",
          },
        }),
      () => postEnvelope(false),
    ]);
    const resolved = await resolveResponseLogicRuleEvaluation({ questionId: "q1", expectedRevision: 3 });
    expect(resolved.persisted).toBe(false);
    expect(resolved.evaluation.sourceFingerprint).toBe(fingerprintLogic(logic));
    expect(resolved.evaluation.kind).toBe("rule-evaluation");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(latestUrl);
    expect(calls[1]!.url).toBe(postUrl);
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ questionId: "q1", expectedRevision: 3 });
  });

  it("does not treat 401 or other non-persistence failures as a missing store", async () => {
    const { calls } = installHostFetch([
      () => jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "请先登录" } }),
    ]);
    await expect(
      resolveResponseLogicRuleEvaluation({ questionId: "q1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("does not treat 409 revision conflicts as a missing store", async () => {
    const { calls } = installHostFetch([
      () =>
        jsonResponse(409, {
          error: { code: "RESPONSE_LOGIC_REVISION_CONFLICT", message: "应答逻辑已更新" },
        }),
    ]);
    await expect(
      resolveResponseLogicRuleEvaluation({ questionId: "q1" }),
    ).rejects.toMatchObject({ code: "RESPONSE_LOGIC_REVISION_CONFLICT" });
    expect(calls).toHaveLength(1);
  });

  it("re-evaluates via POST when the stored result exists but is stale", async () => {
    const { calls } = installHostFetch([() => latestEnvelope(true), () => postEnvelope(true)]);
    const resolved = await resolveResponseLogicRuleEvaluation({ questionId: "q1" });
    expect(resolved.persisted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(postUrl);
  });

  it("serves a fresh stored result without re-evaluating", async () => {
    const { calls } = installHostFetch([() => latestEnvelope(false)]);
    const resolved = await resolveResponseLogicRuleEvaluation({ questionId: "q1" });
    expect(resolved.persisted).toBe(true);
    expect(resolved.evaluation.questionId).toBe("q1");
    expect(calls).toHaveLength(1);
  });

  it("falls back to POST when nothing is stored yet (404)", async () => {
    const { calls } = installHostFetch([
      () => jsonResponse(404, { error: { code: "RESPONSE_LOGIC_EVALUATION_NOT_FOUND", message: "当前问题还没有已保存的评估结果" } }),
      () => postEnvelope(false),
    ]);
    const resolved = await resolveResponseLogicRuleEvaluation({ questionId: "q1" });
    expect(resolved.persisted).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("surfaces a POST failure after the persistence fallback instead of showing success", async () => {
    const { calls } = installHostFetch([
      () =>
        jsonResponse(503, {
          error: { code: "RESPONSE_LOGIC_EVALUATION_PERSISTENCE_UNAVAILABLE", message: "评估结果存储尚未启用" },
        }),
      () => jsonResponse(500, { error: { code: "RESPONSE_LOGIC_EVALUATION_STORE_FAILED", message: "评估结果保存失败" } }),
    ]);
    const error = await resolveResponseLogicRuleEvaluation({ questionId: "q1" }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ResponseLogicEvaluationRequestError);
    expect((error as ResponseLogicEvaluationRequestError).code).toBe("RESPONSE_LOGIC_EVALUATION_STORE_FAILED");
    expect((error as ResponseLogicEvaluationRequestError).status).toBe(500);
    expect(calls).toHaveLength(2);
  });

  it("rethrows transport failures on the latest read without silently retrying", async () => {
    const { calls } = installHostFetch([
      () => {
        throw new TypeError("network down");
      },
    ]);
    await expect(
      resolveResponseLogicRuleEvaluation({ questionId: "q1" }),
    ).rejects.toMatchObject({ code: "RESPONSE_LOGIC_EVALUATION_TRANSPORT_FAILED" });
    expect(calls).toHaveLength(1);
  });
});
