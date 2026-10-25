import { captureWorkspaceRestOperation } from "./runtime-host.js";
import {
  judgeEvaluationEnvelopeSchema,
  type JudgeEvaluationEnvelope,
} from "../contracts/response-logic-judge.js";

/**
 * Client data access for the LLM-as-Judge evaluation.
 * Mirrors the pattern of response-logic-evaluation-client.ts.
 */

export class JudgeRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "JudgeRequestError";
  }
}

function judgeHttpError(status: number, payload: unknown) {
  const apiError =
    payload && typeof payload === "object" && "error" in payload &&
    payload.error && typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>)
      : null;
  const message = typeof apiError?.message === "string" ? apiError.message : `Judge 请求失败（${status}）`;
  const code = typeof apiError?.code === "string" ? apiError.code : "JUDGE_REQUEST_FAILED";
  return new JudgeRequestError(code, message, status);
}

async function judgeFetch(url: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  const rest = captureWorkspaceRestOperation(signal);
  try {
    return await rest.fetch(url, { credentials: "include", ...init, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new JudgeRequestError("JUDGE_TRANSPORT_FAILED", "Judge 请求传输失败", 0);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

/** POST /api/response-logic/evaluation/judge — start an async Judge task. */
export async function startJudgeEvaluation(input: {
  questionId: string;
  expectedRevision?: number;
  signal?: AbortSignal;
}): Promise<{
  taskId: string;
  recordRevision: number;
  sourceFingerprint: string;
  knowledgeFingerprint: string;
}> {
  const response = await judgeFetch("/api/response-logic/evaluation/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionId: input.questionId,
      ...(input.expectedRevision !== undefined && input.expectedRevision > 0
        ? { expectedRevision: input.expectedRevision }
        : {}),
    }),
  }, input.signal);
  const payload = await readJson(response);
  if (!response.ok) throw judgeHttpError(response.status, payload);
  const body = payload as Record<string, unknown>;
  if (typeof body.taskId !== "string" || typeof body.recordRevision !== "number") {
    throw new JudgeRequestError("JUDGE_RESPONSE_INVALID", "Judge 启动响应格式无效", response.status);
  }
  return {
    taskId: body.taskId,
    recordRevision: body.recordRevision,
    sourceFingerprint: String(body.sourceFingerprint ?? ""),
    knowledgeFingerprint: String(body.knowledgeFingerprint ?? "none"),
  };
}

/** GET /api/response-logic/evaluation/judge/tasks/:taskId/status — poll task status. */
export async function pollJudgeTask(input: {
  questionId: string;
  expectedRevision: number;
  taskId: string;
  signal?: AbortSignal;
}): Promise<
  | { status: "running" }
  | { status: "completed"; result: JudgeEvaluationEnvelope }
> {
  const query = new URLSearchParams({
    questionId: input.questionId,
    expectedRevision: String(input.expectedRevision),
  });
  const response = await judgeFetch(
    `/api/response-logic/evaluation/judge/tasks/${encodeURIComponent(input.taskId)}/status?${query}`,
    { method: "GET", headers: { Accept: "application/json" } },
    input.signal,
  );
  const payload = await readJson(response);
  if (!response.ok) throw judgeHttpError(response.status, payload);
  const body = payload as Record<string, unknown>;
  if (body.status === "running") return { status: "running" };
  if (body.status === "completed") {
    const parsed = judgeEvaluationEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw new JudgeRequestError("JUDGE_RESPONSE_INVALID", "Judge 结果未通过传输协议校验", response.status);
    }
    return { status: "completed", result: parsed.data };
  }
  throw new JudgeRequestError("JUDGE_RESPONSE_INVALID", `Judge 任务返回未知状态: ${String(body.status)}`, response.status);
}

/** Context key binding a judge poll to its original question+revision+fingerprint. */
export function judgeContextKey(questionId: string, revision: number, fingerprint: string): string {
  return `${questionId}:${revision}:${fingerprint}`;
}
