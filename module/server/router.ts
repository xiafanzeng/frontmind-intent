import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { workspaceQuestionCategorySchema } from "../contracts/questions.js";
import { saveResponseLogicSchema } from "../contracts/response-logic.js";
import { createIntentQuestionRepository, type IntentQuestionPorts } from "./questions.js";
import { createResponseLogicService, type ResponseLogicPorts } from "./response-logic-service.js";
import { applyQuestionMaintenanceSchema, createQuestionMaintenanceService, type IntentActor, type QuestionMaintenancePorts } from "./question-maintenance-service.js";

export interface IntentRuntimeCore<Actor extends IntentActor = IntentActor> {
  intent: {
    questions: IntentQuestionPorts;
    responseLogic: ResponseLogicPorts;
    maintenance: QuestionMaintenancePorts<Actor>;
  };
  /** Authenticate and authorize the selected project before entering its async scope. */
  withIntentIdentity<T>(request: Request, operation: (identity: { userId: number; actor: Actor }) => Promise<T>): Promise<T>;
  /** Check the intent/Core tables required by this build; additional module tables are compatible. */
  intentReadiness(): Promise<{ ok: boolean; reason?: string }>;
}

const selectInput = z.object({
  questionId: z.string().uuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
  question: z.string().trim().min(2).max(4_000).optional(),
  category: workspaceQuestionCategorySchema.optional(),
  clientRequestId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.questionId ? value.expectedRevision === undefined : !value.question || !value.category) {
    context.addIssue({ code: "custom", message: "Provide an existing question and revision, or a new question and category" });
  }
});
const confirmInput = z.object({
  questionId: z.string().uuid(), expectedRevision: z.number().int().positive(), expectedIntentRevision: z.number().int().positive(),
}).strict();

function failure(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: { code: "INVALID_INPUT", message: "请求字段无效", issues: error.issues.map(({ path, message }) => ({ path, message })) } });
    return;
  }
  const value = error as { code?: unknown; message?: unknown; statusCode?: unknown } | null;
  const code = typeof value?.code === "string" ? value.code : "INTERNAL_ERROR";
  const status = code === "NOT_FOUND" ? 404 : code === "CONFLICT" ? 409 : code === "DATABASE_UNAVAILABLE" ? 503 : code === "FORBIDDEN" ? 403 : code === "UNAUTHORIZED" ? 401 : 500;
  response.status(status).json({ error: { code: status === 500 ? "INTERNAL_ERROR" : code, message: status === 500 ? "请求暂时无法完成" : String(value?.message || code) } });
}

/** Standalone business API. User/project coordinates always come from the Core, never the request body. */
export function createIntentRouter<Actor extends IntentActor>(core: IntentRuntimeCore<Actor>): ReturnType<typeof Router> {
  const router = Router();
  const questions = createIntentQuestionRepository(core.intent.questions);
  const responseLogic = createResponseLogicService(core.intent.responseLogic);
  const maintenance = createQuestionMaintenanceService(core.intent.maintenance);
  router.use(express.json({ limit: "2mb" }));
  function route(method: "get" | "post", path: string, operation: (request: Request, identity: { userId: number; actor: Actor }) => Promise<unknown>) {
    router[method](path, async (request, response) => {
      try {
        const result = await core.withIntentIdentity(request, identity => operation(request, identity));
        response.setHeader("Cache-Control", "no-store");
        response.json(result);
      } catch (error) { failure(response, error); }
    });
  }
  route("get", "/questions", async (_request, identity) => ({ questions: await questions.listEnterpriseQuestions(identity.userId) }));
  route("post", "/questions", async (request, identity) => ({ question: await questions.selectEnterpriseQuestion({ ...selectInput.parse(request.body), userId: identity.userId, actorUserId: identity.actor.id }) }));
  route("post", "/questions/confirm-intent", async (request, identity) => ({ question: await questions.confirmEnterpriseQuestionIntent({ ...confirmInput.parse(request.body), userId: identity.userId }) }));
  route("post", "/questions/maintenance", async (request, identity) => maintenance.applyQuestionMaintenance({ actor: identity.actor, value: applyQuestionMaintenanceSchema.parse(request.body) }));
  route("get", "/response-logic", async (_request, identity) => ({ records: await responseLogic.listResponseLogicEntries(identity.userId) }));
  route("post", "/response-logic", async (request, identity) => ({ record: await responseLogic.saveResponseLogicEntry({ userId: identity.userId, value: saveResponseLogicSchema.strict().parse(request.body) }) }));
  return router;
}

export function createRuntime<Actor extends IntentActor>(core: IntentRuntimeCore<Actor>): { handle: ReturnType<typeof express>; readiness: () => Promise<{ ok: boolean; reason?: string }> } {
  if (!core.intent || typeof core.withIntentIdentity !== "function" || typeof core.intentReadiness !== "function") {
    throw new Error("INTENT_CORE_ADAPTER_UNAVAILABLE");
  }
  const app = express();
  app.disable("x-powered-by");
  app.use("/api/intent", createIntentRouter(core));
  return { handle: app, readiness: () => core.intentReadiness() };
}
