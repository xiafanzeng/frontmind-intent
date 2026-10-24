import { captureWorkspaceRestOperation } from "./runtime-host.js";
import {
  ruleEvaluationEnvelopeSchema,
  ruleEvaluationLatestEnvelopeSchema,
  type RuleEvaluationEnvelope,
  type RuleEvaluationLatestEnvelope,
  type ResponseLogicRuleEvaluation,
} from "../contracts/response-logic-evaluation.js";

export type { ResponseLogicRuleEvaluation } from "../contracts/response-logic-evaluation.js";

/**
 * Client data access for the server-side response-logic rule evaluation.
 * Kept free of UI imports so the fallback behaviour is unit-testable.
 */

export class ResponseLogicEvaluationRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ResponseLogicEvaluationRequestError";
  }
}

function evaluationHttpError(status: number, payload: unknown) {
  const apiError =
    payload && typeof payload === "object" && "error" in payload &&
    payload.error && typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>)
      : null;
  const message =
    typeof apiError?.message === "string"
      ? apiError.message
      : `评估请求失败（${status}）`;
  const code =
    typeof apiError?.code === "string"
      ? apiError.code
      : "RESPONSE_LOGIC_EVALUATION_REQUEST_FAILED";
  return new ResponseLogicEvaluationRequestError(code, message, status);
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function evaluationFetch(
  input: { questionId: string; signal?: AbortSignal },
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const rest = captureWorkspaceRestOperation(input.signal);
  try {
    return await rest.fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ResponseLogicEvaluationRequestError(
      "RESPONSE_LOGIC_EVALUATION_TRANSPORT_FAILED",
      "评估请求传输失败，请稍后重试",
      0,
    );
  }
}

/** Read the latest persisted server-side rule evaluation. null when none is stored. */
export async function fetchLatestResponseLogicRuleEvaluation(input: {
  questionId: string;
  signal?: AbortSignal;
}): Promise<RuleEvaluationLatestEnvelope | null> {
  const query = new URLSearchParams({ questionId: input.questionId });
  const response = await evaluationFetch(
    input,
    `/api/response-logic/evaluation/latest?${query.toString()}`,
    { method: "GET" },
  );
  const payload = await readJsonPayload(response);
  if (response.status === 404) return null;
  if (!response.ok) throw evaluationHttpError(response.status, payload);
  const parsed = ruleEvaluationLatestEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ResponseLogicEvaluationRequestError(
      "RESPONSE_LOGIC_EVALUATION_RESPONSE_INVALID",
      "服务端返回的评估结果未通过传输协议校验",
      response.status,
    );
  }
  return parsed.data;
}

/** Run one server-side rule evaluation against the authoritative stored record. */
export async function fetchResponseLogicRuleEvaluation(input: {
  questionId: string;
  expectedRevision?: number;
  signal?: AbortSignal;
}): Promise<RuleEvaluationEnvelope> {
  const response = await evaluationFetch(input, "/api/response-logic/evaluation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionId: input.questionId,
      ...(input.expectedRevision !== undefined
        ? { expectedRevision: input.expectedRevision }
        : {}),
    }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) throw evaluationHttpError(response.status, payload);
  const parsed = ruleEvaluationEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ResponseLogicEvaluationRequestError(
      "RESPONSE_LOGIC_EVALUATION_RESPONSE_INVALID",
      "服务端返回的评估结果未通过传输协议校验",
      response.status,
    );
  }
  return parsed.data;
}

/**
 * Resolve the freshest usable evaluation for one question.
 *
 * GET latest is the fast path. The explicit persistence-unavailable state
 * (evaluation-history table not deployed yet) and a missing stored result both
 * fall through to an on-demand POST evaluation, which still returns the
 * computed result with persisted:false. Every other error — 401/403/409/500,
 * transport failure, invalid payload — is rethrown untouched and must surface
 * to the user; nothing is silently swallowed or retried against the rules.
 */
export async function resolveResponseLogicRuleEvaluation(input: {
  questionId: string;
  expectedRevision?: number;
  signal?: AbortSignal;
}): Promise<{ evaluation: ResponseLogicRuleEvaluation; persisted: boolean }> {
  let latest: RuleEvaluationLatestEnvelope | null = null;
  try {
    latest = await fetchLatestResponseLogicRuleEvaluation(input);
  } catch (error) {
    if (
      !(error instanceof ResponseLogicEvaluationRequestError) ||
      error.code !== "RESPONSE_LOGIC_EVALUATION_PERSISTENCE_UNAVAILABLE"
    ) {
      throw error;
    }
  }
  if (latest && !latest.stale) {
    return { evaluation: latest.evaluation, persisted: true };
  }
  const computed = await fetchResponseLogicRuleEvaluation(input);
  return { evaluation: computed.evaluation, persisted: computed.persisted };
}
