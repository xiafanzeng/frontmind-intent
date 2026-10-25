import { captureWorkspaceRestOperation } from "./runtime-host.js";
import {
  optimizationEnvelopeSchema,
  type OptimizationEnvelope,
} from "../contracts/response-logic-optimization.js";

/**
 * Client data access for the LLM response-logic optimization.
 * Mirrors the pattern of response-logic-judge-client.ts.
 */

export class OptimizationRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "OptimizationRequestError";
  }
}

function optimizationHttpError(status: number, payload: unknown) {
  const apiError =
    payload && typeof payload === "object" && "error" in payload &&
    payload.error && typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>)
      : null;
  const message = typeof apiError?.message === "string" ? apiError.message : `优化请求失败（${status}）`;
  const code = typeof apiError?.code === "string" ? apiError.code : "OPTIMIZATION_REQUEST_FAILED";
  return new OptimizationRequestError(code, message, status);
}

async function optimizationFetch(url: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  const rest = captureWorkspaceRestOperation(signal);
  try {
    return await rest.fetch(url, { credentials: "include", ...init, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new OptimizationRequestError("OPTIMIZATION_TRANSPORT_FAILED", "优化请求传输失败", 0);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

/** POST /api/response-logic/optimization — start an optimization task for a completed judge task. */
export async function startOptimizationGeneration(input: {
  questionId: string;
  expectedRevision?: number;
  judgeTaskId: string;
  signal?: AbortSignal;
}): Promise<{
  taskId: string;
  recordRevision: number;
  sourceFingerprint: string;
  judgeTaskId: string;
  knowledgeFingerprint: string;
}> {
  const response = await optimizationFetch("/api/response-logic/optimization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionId: input.questionId,
      judgeTaskId: input.judgeTaskId,
      ...(input.expectedRevision !== undefined && input.expectedRevision > 0
        ? { expectedRevision: input.expectedRevision }
        : {}),
    }),
  }, input.signal);
  const payload = await readJson(response);
  if (!response.ok) throw optimizationHttpError(response.status, payload);
  const body = payload as Record<string, unknown>;
  if (typeof body.taskId !== "string" || typeof body.recordRevision !== "number") {
    throw new OptimizationRequestError("OPTIMIZATION_RESPONSE_INVALID", "优化启动响应格式无效", response.status);
  }
  return {
    taskId: body.taskId,
    recordRevision: body.recordRevision,
    sourceFingerprint: String(body.sourceFingerprint ?? ""),
    judgeTaskId: String(body.judgeTaskId ?? input.judgeTaskId),
    knowledgeFingerprint: String(body.knowledgeFingerprint ?? "none"),
  };
}

/** GET /api/response-logic/optimization/tasks/:taskId/status — poll task status. */
export async function pollOptimizationTask(input: {
  questionId: string;
  expectedRevision: number;
  judgeTaskId: string;
  taskId: string;
  signal?: AbortSignal;
}): Promise<
  | { status: "running" }
  | { status: "completed"; result: OptimizationEnvelope }
> {
  const query = new URLSearchParams({
    questionId: input.questionId,
    expectedRevision: String(input.expectedRevision),
    judgeTaskId: input.judgeTaskId,
  });
  const response = await optimizationFetch(
    `/api/response-logic/optimization/tasks/${encodeURIComponent(input.taskId)}/status?${query}`,
    { method: "GET", headers: { Accept: "application/json" } },
    input.signal,
  );
  const payload = await readJson(response);
  if (!response.ok) throw optimizationHttpError(response.status, payload);
  const body = payload as Record<string, unknown>;
  if (body.status === "running") return { status: "running" };
  if (body.status === "completed") {
    const parsed = optimizationEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw new OptimizationRequestError("OPTIMIZATION_RESPONSE_INVALID", "优化结果未通过传输协议校验", response.status);
    }
    return { status: "completed", result: parsed.data };
  }
  throw new OptimizationRequestError("OPTIMIZATION_RESPONSE_INVALID", `优化任务返回未知状态: ${String(body.status)}`, response.status);
}

/**
 * Context key binding an optimization task to its original question +
 * revision + draft fingerprint + judge task. Matches the server-side binding
 * (the start endpoint re-verifies the judge task against exactly this context).
 */
export function optimizationContextKey(questionId: string, revision: number, fingerprint: string, judgeTaskId: string): string {
  return `${questionId}:${revision}:${fingerprint}:${judgeTaskId}`;
}
