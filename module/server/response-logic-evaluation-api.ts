import { Router, type Response } from "express";
import { z } from "zod";
import {
  RULE_EVALUATION_VERSION,
  createResponseLogicRuleEvaluation,
  fingerprintLogic,
  ruleEvaluationEnvelopeSchema,
  ruleEvaluationLatestEnvelopeSchema,
  type LogicSections,
} from "../contracts/response-logic-evaluation.js";
import type { ResponseLogicRecordDto } from "../contracts/response-logic.js";
import type { CoreRequest, ResponseLogicApiPorts } from "./task-ports.js";
import type { ResponseLogicEvaluationStore } from "./response-logic-evaluation-store.js";

/**
 * Server-side rule evaluation of one response-logic record.
 *
 * Mounted by createResponseLogicApi under /evaluation, so the host's existing
 * /api/response-logic mount serves these routes in both the Dashboard and the
 * development subdomain without any host-side change. The evaluated content is
 * always the authoritative stored record; request bodies never carry draft
 * text. Rule evaluation is deterministic and honest about its boundary: it is
 * not a semantic judge.
 */
type EvaluationCore = Pick<
  ResponseLogicApiPorts,
  | "enterpriseWorkspaceUserId"
  | "assertServiceCapability"
  | "ServiceEntitlementError"
  | "sendAiBillingError"
  | "getDashboardQuestion"
  | "getResponseLogicEntry"
> & { evaluationStore: ResponseLogicEvaluationStore };

const evaluateInputSchema = z
  .object({
    questionId: z.string().trim().min(1).max(191),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

const latestQuerySchema = z
  .object({ questionId: z.string().trim().min(1).max(191) })
  .strict();

function evaluationError(
  res: Response,
  status: number,
  code: string,
  message: string,
) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: { code, message } });
}

export function createResponseLogicEvaluationRouter(core: EvaluationCore): import("express").Router {
  const router = Router();

  /** Identity, capability, configured question and the authoritative record. */
  async function resolveRecord(
    req: CoreRequest,
    res: Response,
    questionId: string,
  ): Promise<{ record: ResponseLogicRecordDto; workspaceUserId: number } | null> {
    const user = req.frontmindUser;
    if (!user) {
      evaluationError(res, 401, "UNAUTHORIZED", "请先登录");
      return null;
    }
    const workspaceUserId = core.enterpriseWorkspaceUserId(user.id);
    await core.assertServiceCapability(workspaceUserId, "responseLogic");
    const configuredQuestion = await core.getDashboardQuestion(
      workspaceUserId,
      questionId,
    );
    if (!configuredQuestion) {
      evaluationError(
        res,
        422,
        "RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED",
        "当前问题尚未由管理员配置",
      );
      return null;
    }
    const record = await core.getResponseLogicEntry(workspaceUserId, questionId);
    if (!record) {
      evaluationError(
        res,
        404,
        "RESPONSE_LOGIC_RECORD_MISSING",
        "当前问题还没有应答逻辑内容，请先生成或保存草稿",
      );
      return null;
    }
    return { record, workspaceUserId };
  }

  function evaluationFailure(res: Response, error: unknown) {
    if (core.sendAiBillingError(res, error)) return;
    if (error instanceof core.ServiceEntitlementError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "DATABASE_UNAVAILABLE") {
      evaluationError(res, 503, "DATABASE_UNAVAILABLE", "评估服务暂时不可用，请稍后重试");
      return;
    }
    console.error("[Response Logic Evaluation] error:", error);
    evaluationError(res, 500, "RESPONSE_LOGIC_EVALUATION_FAILED", "评估请求失败，请稍后重试");
  }

  router.post("/", async (request, res) => {
    const req = request as CoreRequest;
    try {
      const parsed = evaluateInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        evaluationError(
          res,
          400,
          "INVALID_RESPONSE_LOGIC_EVALUATION_INPUT",
          "评估请求格式不完整",
        );
        return;
      }
      const resolved = await resolveRecord(req, res, parsed.data.questionId);
      if (!resolved) return;
      const { record, workspaceUserId } = resolved;
      if (
        parsed.data.expectedRevision !== undefined &&
        parsed.data.expectedRevision !== record.revision
      ) {
        res.setHeader("Cache-Control", "no-store");
        res.status(409).json({
          error: {
            code: "RESPONSE_LOGIC_REVISION_CONFLICT",
            message: `应答逻辑已更新到 R${record.revision}，当前请求基于 R${parsed.data.expectedRevision}；请刷新后重试`,
            actualRevision: record.revision,
          },
        });
        return;
      }
      const logic: LogicSections = {
        concern: record.draft.concern,
        conclusion: record.draft.conclusion,
        facts: record.draft.facts,
        boundaries: record.draft.boundaries,
      };
      const evaluation = createResponseLogicRuleEvaluation({
        questionId: record.questionId,
        question: record.question,
        intent: record.intent,
        version: record.confirmed?.version ?? null,
        revision: record.revision,
        logic,
      });
      if (!ruleEvaluationEnvelopeSchema.shape.evaluation.safeParse(evaluation).success) {
        evaluationError(
          res,
          500,
          "RESPONSE_LOGIC_EVALUATION_OUTPUT_INVALID",
          "评估结果未通过内部校验，已阻止返回",
        );
        return;
      }
      let persisted = false;
      try {
        const saved = await core.evaluationStore.save({
          userId: workspaceUserId,
          questionId: record.questionId,
          recordRevision: record.revision,
          confirmedVersion: record.confirmed?.version ?? null,
          ruleVersion: RULE_EVALUATION_VERSION,
          evaluation,
        });
        persisted = saved.available ? saved.value : false;
      } catch (storeError) {
        console.error("[Response Logic Evaluation] store save failed:", storeError);
        evaluationError(
          res,
          500,
          "RESPONSE_LOGIC_EVALUATION_STORE_FAILED",
          "评估结果保存失败，请稍后重试",
        );
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json(
        ruleEvaluationEnvelopeSchema.parse({
          status: "completed",
          persisted,
          ruleVersion: RULE_EVALUATION_VERSION,
          recordRevision: record.revision,
          confirmedVersion: record.confirmed?.version ?? null,
          evaluatedAt: new Date().toISOString(),
          evaluation,
        }),
      );
    } catch (error) {
      evaluationFailure(res, error);
    }
  });

  router.get("/latest", async (request, res) => {
    const req = request as CoreRequest;
    try {
      const parsed = latestQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        evaluationError(
          res,
          400,
          "INVALID_RESPONSE_LOGIC_EVALUATION_INPUT",
          "缺少当前问题标识",
        );
        return;
      }
      const resolved = await resolveRecord(req, res, parsed.data.questionId);
      if (!resolved) return;
      const { record } = resolved;
      const stored = await core.evaluationStore.getLatest(
        resolved.workspaceUserId,
        parsed.data.questionId,
      );
      if (!stored.available) {
        evaluationError(
          res,
          503,
          "RESPONSE_LOGIC_EVALUATION_PERSISTENCE_UNAVAILABLE",
          "评估结果存储尚未启用（等待数据库迁移），请重新发起评估",
        );
        return;
      }
      if (!stored.value) {
        evaluationError(
          res,
          404,
          "RESPONSE_LOGIC_EVALUATION_NOT_FOUND",
          "当前问题还没有已保存的评估结果",
        );
        return;
      }
      const currentFingerprint = fingerprintLogic({
        concern: record.draft.concern,
        conclusion: record.draft.conclusion,
        facts: record.draft.facts,
        boundaries: record.draft.boundaries,
      });
      const stale = stored.value.sourceFingerprint !== currentFingerprint;
      res.setHeader("Cache-Control", "no-store");
      res.json(
        ruleEvaluationLatestEnvelopeSchema.parse({
          status: "completed",
          stale,
          ruleVersion: stored.value.ruleVersion,
          recordRevision: record.revision,
          confirmedVersion: record.confirmed?.version ?? null,
          evaluation: stored.value.evaluation,
        }),
      );
    } catch (error) {
      evaluationFailure(res, error);
    }
  });

  return router;
}
