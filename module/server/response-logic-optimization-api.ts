import { createHash } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { isAbsolute, join, resolve } from "node:path";
import { fingerprintLogic, type LogicSections } from "../contracts/response-logic-evaluation.js";
import {
  optimizationOutputSchema,
  optimizationEnvelopeSchema,
  verifyOptimizationEvidence,
  verifyOptimizedDraftStructure,
  type OptimizationOutput,
} from "../contracts/response-logic-optimization.js";
import type { CoreRequest } from "./task-ports.js";
import type { JudgeOutput } from "../contracts/response-logic-judge.js";
import { buildDirectorySkillArchive } from "./directory-skill-archive.js";
import {
  createJudgeContextResolver,
  judgeError,
  parseStructuredEnvelopePayload,
  parseJudgePayload,
  validateJudgeConsistency,
  compactKnowledgeForVerification,
  type EvaluationCore,
  type KnowledgeSnapshotForJudge,
} from "./response-logic-judge-api.js";

/**
 * LLM optimization of one response-logic draft, driven by a verified Judge
 * diagnosis.
 *
 * Mounted by createResponseLogicApi under /optimization. Mirrors the judge's
 * async-task pattern (skill + turn-input + evidence attachments, idempotent
 * createTask, ownership via upstream_resources, revision guards).
 *
 * The optimizer NEVER trusts client-supplied evaluation content: the start
 * endpoint re-fetches the referenced judge task from the upstream, re-runs the
 * full judge validation chain (schema, score recomputation, draft/knowledge
 * evidence) against the CURRENT draft, and only then packs the diagnosis into
 * the optimizer turn-input. If the judge result is unavailable, unfinished or
 * inconsistent with the current record the request fails loudly — there is no
 * silent fallback to plain generation.
 *
 * The output is a CANDIDATE draft with per-change reasons and verifiable
 * evidence; nothing here writes the live record.
 */

const OPTIMIZER_STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  properties: { payload: { type: "string" } },
  required: ["payload"],
  additionalProperties: false,
} as const;

const OPTIMIZER_SKILL_ATTACHMENT_FILENAME = "response-logic-optimizer.skill.zip";
const OPTIMIZER_TURN_INPUT_ATTACHMENT_FILENAME = "response-logic-optimization-turn-input.zip";

const configuredOptimizerSkillPath =
  process.env.FRONTMIND_RESPONSE_LOGIC_OPTIMIZER_SKILL_PATH?.trim();

/** Candidate directories for the optimizer Skill (same semantics as judge). */
export function optimizerSkillDirectoryCandidates(configuredPath: string | undefined): string[] {
  if (configuredPath) return [configuredPath];
  return [
    join(import.meta.dirname, "../workflows/response-logic-optimizer.skill"),
    join(process.cwd(), "modules/intent/workflows/response-logic-optimizer.skill"),
    join(process.cwd(), "private-workflows/response-logic-optimizer.skill"),
    resolve(process.cwd(), "../../module-build/module/workflows/response-logic-optimizer.skill"),
  ];
}

export async function buildOptimizerSkillArchive(configuredPath: string | undefined = configuredOptimizerSkillPath) {
  // Validated lazily on purpose: a misconfigured optimizer-only env key must
  // fail this endpoint, not prevent the whole service from booting.
  if (configuredPath && !isAbsolute(configuredPath)) {
    throw new Error(`FRONTMIND_RESPONSE_LOGIC_OPTIMIZER_SKILL_PATH must be an absolute path (got: ${configuredPath})`);
  }
  const skillDirectoryCandidates = optimizerSkillDirectoryCandidates(configuredPath);
  try {
    return await buildDirectorySkillArchive({
      name: "response-logic-optimizer",
      version: "1",
      directoryCandidates: skillDirectoryCandidates,
      files: ["SKILL.md", "references/output-contract.md", "references/rubric.md"],
    });
  } catch (error) {
    throw new Error(
      `Could not load Skill response-logic-optimizer (tried: ${skillDirectoryCandidates.join("; ")})`,
      { cause: error },
    );
  }
}

const optimizationStartInputSchema = z
  .object({
    questionId: z.string().trim().min(1).max(191),
    expectedRevision: z.number().int().positive().optional(),
    judgeTaskId: z.string().trim().min(1).max(255),
  })
  .strict();

const optimizationStatusQuerySchema = z
  .object({
    questionId: z.string().trim().min(1).max(191),
    expectedRevision: z.coerce.number().int().positive(),
    judgeTaskId: z.string().trim().min(1).max(255),
  })
  .strict();

function optimizationIdempotencyKey(input: {
  userId: number;
  questionId: string;
  recordRevision: number;
  sourceFingerprint: string;
  judgeTaskId: string;
  skillContentHash: string;
  knowledgeFingerprint: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "frontmind-response-logic-optimizer-v1",
        input.userId,
        input.questionId,
        input.recordRevision,
        input.sourceFingerprint,
        input.judgeTaskId,
        input.skillContentHash,
        input.knowledgeFingerprint,
      ]),
      "utf8",
    )
    .digest("hex");
}

function knowledgeFingerprintOf(snapshot: KnowledgeSnapshotForJudge): string {
  return snapshot
    ? createHash("sha256")
        .update(snapshot.documents.map((doc) => doc.content).join("\n"), "utf8")
        .digest("hex")
    : "none";
}

async function buildOptimizerTurnInputArchive(
  core: EvaluationCore,
  input: {
    questionId: string;
    question: string;
    intent: string;
    logic: LogicSections;
    judge: JudgeOutput;
    judgeTaskId: string;
    knowledgeSnapshot: KnowledgeSnapshotForJudge;
    evidenceFilename: string | null;
    skillFilename: string;
    revision: number;
    sourceFingerprint: string;
  },
) {
  return core.buildDeterministicTaskAttachmentArchive({
    name: "response-logic-optimization-turn-input",
    entrypoint: "turn-input.json",
    files: [
      {
        path: "turn-input.json",
        content: `${JSON.stringify(
          {
            schemaVersion: 1,
            kind: "frontmind.response-logic.optimizer-input",
            question: {
              id: input.questionId,
              text: input.question,
              intent: input.intent,
            },
            currentDraft: input.logic,
            judgeEvaluation: {
              judgeTaskId: input.judgeTaskId,
              recordRevision: input.revision,
              sourceFingerprint: input.sourceFingerprint,
              judge: input.judge,
            },
            knowledgeSnapshot: input.knowledgeSnapshot
              ? {
                  available: true,
                  version: input.knowledgeSnapshot.version,
                  sourceFileName: input.knowledgeSnapshot.sourceFileName,
                  evidenceAttachment: input.evidenceFilename,
                }
              : {
                  available: false,
                  evidenceAttachment: null,
                  restriction:
                    "知识库不可用。优化时不得引入任何企业事实；缺失处保留不确定性表述，不得编造来源。",
                },
            outputContract: {
              format: "manus_v2_structured_output",
              requiredFields: ["payload"],
              payloadIsJSON: true,
              noScores: true,
              candidateOnly: true,
            },
          },
          null,
          2,
        )}\n`,
      },
    ],
    metadata: { schemaVersion: 1, role: "server_authoritative_input" },
  });
}

function buildOptimizerPrompt(input: {
  skillFilename: string;
  turnInputFilename: string;
  evidenceFilename: string | null;
  hasKnowledge: boolean;
}) {
  const evidenceInstruction = input.hasKnowledge
    ? `解压并读取附件 ${input.evidenceFilename} 中的 knowledge.md；企业事实只能引用其中实际存在的内容。`
    : "知识库不可用。不得引入任何企业事实；缺失处保留不确定性表述，不得编造来源。";
  return `严格执行首次任务附件 ${input.skillFilename}；先解压并完整读取 SKILL.md、references/output-contract.md 和 references/rubric.md。
必须解压附件 ${input.turnInputFilename} 并完整读取 turn-input.json。它是当前问题、草稿、Judge 四维评估结论（唯一诊断依据）与输出约束的唯一服务端权威输入。
${evidenceInstruction}
基于 turn-input.json 中 judgeEvaluation 的 findings 与建议，对 currentDraft 的四个字段生成优化后的候选版本：逐项解决真实缺陷，保留正确内容，每项关键修改说明原因并附可核验证据。优化结果是候选版本，不是直接采用。把完整优化结果序列化为严格 JSON，装入 v2 structured output 的 payload 字符串字段。不输出评分或综合分。`;
}

/** Validate an optimization output against the contract and real sources. */
function validateOptimizationConsistency(
  optimization: OptimizationOutput,
  logic: LogicSections,
  knowledgeContent: string | null,
): { ok: true } | { ok: false; code: string; message: string } {
  const structure = verifyOptimizedDraftStructure(optimization);
  if (!structure.ok) {
    return { ok: false, code: "OPTIMIZATION_STRUCTURE_INVALID", message: `优化输出结构不合法: ${structure.reason}` };
  }
  const evidence = verifyOptimizationEvidence(optimization, logic, knowledgeContent);
  if (evidence.invalid > 0) {
    const fabricated = evidence.invalidExcerpts[0] ?? "";
    if (evidence.invalidKnowledge > 0) {
      return knowledgeContent === null
        ? {
            ok: false,
            code: "OPTIMIZATION_KNOWLEDGE_EVIDENCE_UNAVAILABLE",
            message: `${evidence.invalidKnowledge} 条知识证据在知识库不可用时无法核验（模型不应编造引用）: ${fabricated}`,
          }
        : {
            ok: false,
            code: "OPTIMIZATION_KNOWLEDGE_EVIDENCE_INVALID",
            message: `${evidence.invalidKnowledge} 条知识证据摘录未在知识材料中找到: ${fabricated}`,
          };
    }
    return {
      ok: false,
      code: "OPTIMIZATION_EVIDENCE_EXCERPT_INVALID",
      message: `${evidence.invalidDraft} 条草稿证据摘录未在应答逻辑原文中找到: ${fabricated}`,
    };
  }
  return { ok: true };
}

export function createResponseLogicOptimizationRouter(core: EvaluationCore): import("express").Router {
  const router = Router();
  const resolveContext = createJudgeContextResolver(core);

  function optimizationFailure(res: Response, error: unknown) {
    if (core.sendAiBillingError(res, error)) return;
    if (error instanceof core.ServiceEntitlementError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "DATABASE_UNAVAILABLE") {
      judgeError(res, 503, "DATABASE_UNAVAILABLE", "优化服务暂时不可用");
      return;
    }
    console.error("[Response Logic Optimization] error:", safeErrorForOptimizationLog(error));
    judgeError(res, 500, "RESPONSE_LOGIC_OPTIMIZATION_FAILED", "优化请求失败");
  }

  /* -- POST / (start) -- */

  router.post("/", async (request, res) => {
    const req = request as CoreRequest;
    try {
      const parsed = optimizationStartInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        judgeError(res, 400, "INVALID_RESPONSE_LOGIC_OPTIMIZATION_INPUT", "优化请求格式不完整");
        return;
      }
      const ctx = await resolveContext(req, res, parsed.data.questionId, parsed.data.expectedRevision);
      if (!ctx) return;
      const { record, workspaceUserId, logic, fingerprint } = ctx;

      const requestCredential = core.credentialForRequest(request);
      if (!requestCredential) {
        res.status(428).json({
          error: { code: "CUSTOMER_KEY_REQUIRED", message: "当前客户账号尚未配置 API Key" },
        });
        return;
      }
      const activeCredentials = core.getFrontMindCredentials(request);
      if (!activeCredentials.credentialRef) {
        res.status(401).json({ error: { message: "尚未配置 API Key" } });
        return;
      }

      // ---- Server-side judge result: re-fetch, never trust the client ----
      const judgeCredential = await core.getCredentialForUpstreamResource(workspaceUserId, "task", parsed.data.judgeTaskId);
      if (!judgeCredential) {
        judgeError(res, 403, "OPTIMIZATION_JUDGE_TASK_FORBIDDEN", "引用的 Judge 任务不属于此账号");
        return;
      }
      const judgeClient = core.createCredentialAgentClient(judgeCredential, {
        baseUrl: core.getUpstreamBaseUrl(request),
        accountUserId: workspaceUserId,
      });
      const judgeEvents = await judgeClient.listAllMessages({ taskId: parsed.data.judgeTaskId, order: "desc" });
      const judgeState = core.latestManusV2TaskState(judgeEvents);
      if (judgeState === null || judgeState === "running" || judgeState === "waiting") {
        judgeError(res, 422, "OPTIMIZATION_JUDGE_NOT_COMPLETED", "引用的 Judge 任务尚未完成，优化不能基于未完成的评估");
        return;
      }
      if (judgeState === "error") {
        judgeError(res, 422, "OPTIMIZATION_JUDGE_FAILED", "引用的 Judge 任务已失败，请重新评估后再优化");
        return;
      }
      if (judgeState !== "stopped") {
        judgeError(res, 502, "OPTIMIZATION_JUDGE_STATUS_INVALID", "引用的 Judge 任务返回了无法识别的状态");
        return;
      }
      const judgeResult = parseJudgePayload(core, judgeEvents);
      if (!judgeResult.ok) {
        judgeError(res, 422, "OPTIMIZATION_JUDGE_RESULT_UNAVAILABLE", `引用的 Judge 结果不可用（${judgeResult.code}）；请重新评估后再优化`);
        return;
      }
      // Re-run the FULL judge validation against the CURRENT record so the
      // diagnosis provably belongs to this exact draft (draft excerpts must
      // exist in the current four sections) and current knowledge.
      const knowledgeSnapshot = await core.getLatestKnowledgeSnapshot(workspaceUserId);
      const knowledgeContent = knowledgeSnapshot ? compactKnowledgeForVerification(knowledgeSnapshot) : null;
      const judgeConsistency = validateJudgeConsistency(judgeResult.judge, logic, knowledgeContent);
      if (!judgeConsistency.ok) {
        judgeError(res, 422, "OPTIMIZATION_JUDGE_CONTEXT_MISMATCH", `Judge 结果与当前应答逻辑/知识状态不一致（${judgeConsistency.code}），请基于当前内容重新评估`);
        return;
      }

      // ---- Build optimizer inputs ----
      const configuredQuestion = await core.getDashboardQuestion(workspaceUserId, parsed.data.questionId);
      const knowledgeFingerprint = knowledgeFingerprintOf(knowledgeSnapshot);

      let evidenceUploadFilename: string | null = null;
      let evidenceArchiveBytes: Buffer | null = null;
      if (knowledgeSnapshot) {
        const evidenceContent = compactKnowledgeForVerification(knowledgeSnapshot);
        const evidenceArchive = await core.buildDeterministicTaskAttachmentArchive({
          name: "response-logic-optimization-evidence",
          entrypoint: "knowledge.md",
          files: [
            {
              path: "context.json",
              content: `${JSON.stringify({ schemaVersion: 1, knowledgeSnapshot: { version: knowledgeSnapshot.version, sourceFileName: knowledgeSnapshot.sourceFileName } }, null, 2)}\n`,
            },
            { path: "knowledge.md", content: evidenceContent },
          ],
        });
        evidenceUploadFilename = `response-logic-optimization-evidence-${evidenceArchive.contentHash.slice(0, 12)}.zip`;
        evidenceArchiveBytes = evidenceArchive.bytes;
      }

      const skillArchive = await buildOptimizerSkillArchive();
      const skillFilename = `${OPTIMIZER_SKILL_ATTACHMENT_FILENAME.replace(".zip", "")}-${skillArchive.contentHash}.zip`;

      const turnInputArchive = await buildOptimizerTurnInputArchive(core, {
        questionId: parsed.data.questionId,
        question: configuredQuestion?.question ?? record.question,
        intent: configuredQuestion?.intent ?? record.intent,
        logic,
        judge: judgeResult.judge,
        judgeTaskId: parsed.data.judgeTaskId,
        knowledgeSnapshot,
        evidenceFilename: evidenceUploadFilename,
        skillFilename,
        revision: record.revision,
        sourceFingerprint: fingerprint,
      });
      const turnInputFilename = `${OPTIMIZER_TURN_INPUT_ATTACHMENT_FILENAME.replace(".zip", "")}-${turnInputArchive.contentHash}.zip`;

      const prompt = core.assertUpstreamPromptBudget(
        buildOptimizerPrompt({
          skillFilename,
          turnInputFilename,
          evidenceFilename: evidenceUploadFilename,
          hasKnowledge: Boolean(knowledgeSnapshot),
        }),
      );

      const idemKey = optimizationIdempotencyKey({
        userId: workspaceUserId,
        questionId: parsed.data.questionId,
        recordRevision: record.revision,
        sourceFingerprint: fingerprint,
        judgeTaskId: parsed.data.judgeTaskId,
        skillContentHash: skillArchive.contentHash,
        knowledgeFingerprint,
      });

      const client = core.createCredentialAgentClient(requestCredential, {
        baseUrl: core.getUpstreamBaseUrl(request),
        accountUserId: workspaceUserId,
        intentId: idemKey,
        rateLimitScope: `managed-user:${workspaceUserId}`,
      });

      const attachments: Array<{ file_id: string; filename: string }> = [];
      const skillUpload = await client.uploadFile({ filename: skillFilename, bytes: skillArchive.bytes, contentType: "application/zip" });
      attachments.push({ file_id: skillUpload.fileId, filename: skillFilename });
      const turnInputUpload = await client.uploadFile({ filename: turnInputFilename, bytes: turnInputArchive.bytes, contentType: "application/zip" });
      attachments.push({ file_id: turnInputUpload.fileId, filename: turnInputFilename });
      if (evidenceUploadFilename && evidenceArchiveBytes) {
        const evidenceUpload = await client.uploadFile({ filename: evidenceUploadFilename, bytes: evidenceArchiveBytes, contentType: "application/zip" });
        attachments.push({ file_id: evidenceUpload.fileId, filename: evidenceUploadFilename });
      }

      const created = await client.createTask({
        prompt: `${prompt}\n\nFRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({ operationToken: idemKey })}`,
        attachments,
        title: `FrontMind optimizer ${idemKey.slice(0, 24)}`,
        agentProfile: core.toUpstreamAgentProfile(requestCredential.agentProfile),
        locale: "zh-CN",
        interactiveMode: false,
        structuredOutputSchema: OPTIMIZER_STRUCTURED_OUTPUT_SCHEMA,
      });

      try {
        await core.recordUpstreamResource({
          userId: workspaceUserId,
          apiCredentialId: requestCredential.id,
          kind: "task",
          upstreamId: created.taskId,
        });
      } catch (bindingError) {
        console.error("[Response Logic Optimization] task binding pending:", {
          taskId: created.taskId,
          error: safeErrorForOptimizationLog(bindingError),
        });
        res.status(502).json({
          error: {
            code: "RESPONSE_LOGIC_OPTIMIZATION_BINDING_PENDING",
            message: "优化任务已创建，但本地绑定未完成；请重置后重新开始",
            retryable: false,
            resetRequired: true,
          },
        });
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({
        taskId: created.taskId,
        status: "running",
        recordRevision: record.revision,
        sourceFingerprint: fingerprint,
        judgeTaskId: parsed.data.judgeTaskId,
        knowledgeFingerprint,
        optimizerVersion: "1",
      });
    } catch (error) {
      optimizationFailure(res, error);
    }
  });

  /* -- GET /tasks/:taskId/status -- */

  router.get("/tasks/:taskId/status", async (request, res) => {
    try {
      const parsed = optimizationStatusQuerySchema.safeParse(request.query);
      const taskId = String(request.params.taskId || "").trim();
      if (!taskId || taskId.length > 255 || !parsed.success) {
        judgeError(res, 400, "INVALID_RESPONSE_LOGIC_OPTIMIZATION_INPUT", "缺少当前问题、版本或任务标识");
        return;
      }
      const req = request as CoreRequest;
      const ctx = await resolveContext(req, res, parsed.data.questionId, parsed.data.expectedRevision);
      if (!ctx) return;
      const { record, workspaceUserId, logic, fingerprint } = ctx;

      const credential = await core.getCredentialForUpstreamResource(workspaceUserId, "task", taskId);
      if (!credential) {
        judgeError(res, 403, "RESPONSE_LOGIC_OPTIMIZATION_TASK_FORBIDDEN", "当前优化任务不属于此账号");
        return;
      }

      const client = core.createCredentialAgentClient(credential, {
        baseUrl: core.getUpstreamBaseUrl(request),
        accountUserId: workspaceUserId,
      });
      const events = await client.listAllMessages({ taskId, order: "desc" });
      const status = core.latestManusV2TaskState(events);

      if (status === null || status === "running" || status === "waiting") {
        res.setHeader("Cache-Control", "no-store");
        res.status(202).json({
          status: "running",
          taskId,
          expectedRevision: parsed.data.expectedRevision,
          model: credential.agentProfile,
        });
        return;
      }
      if (status === "error") {
        judgeError(res, 422, "RESPONSE_LOGIC_OPTIMIZATION_TASK_FAILED", "优化任务执行失败");
        return;
      }
      if (status !== "stopped") {
        judgeError(res, 502, "RESPONSE_LOGIC_OPTIMIZATION_STATUS_INVALID", "优化任务返回了无法识别的状态");
        return;
      }

      const envelope = parseStructuredEnvelopePayload(
        core, events,
        "OPTIMIZATION_PAYLOAD_INVALID_JSON", "优化输出的 payload 不是有效 JSON",
      );
      if (!envelope.ok) {
        judgeError(res, 422, envelope.code, envelope.message);
        return;
      }
      const schemaResult = optimizationOutputSchema.safeParse(envelope.parsed);
      if (!schemaResult.success) {
        judgeError(res, 422, "OPTIMIZATION_OUTPUT_SCHEMA_MISMATCH", `优化输出未通过 Schema 校验: ${schemaResult.error.issues[0]?.path.join(".")} — ${schemaResult.error.issues[0]?.message}`);
        return;
      }

      const knowledgeSnapshot = await core.getLatestKnowledgeSnapshot(workspaceUserId);
      const knowledgeContent = knowledgeSnapshot ? compactKnowledgeForVerification(knowledgeSnapshot) : null;
      const consistency = validateOptimizationConsistency(schemaResult.data, logic, knowledgeContent);
      if (!consistency.ok) {
        judgeError(res, 422, consistency.code, consistency.message);
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json(
        optimizationEnvelopeSchema.parse({
          status: "completed",
          optimizerVersion: "1",
          recordRevision: record.revision,
          sourceFingerprint: fingerprint,
          judgeTaskId: parsed.data.judgeTaskId,
          knowledgeFingerprint: knowledgeFingerprintOf(knowledgeSnapshot),
          evaluatedAt: new Date().toISOString(),
          optimization: schemaResult.data,
        }),
      );
    } catch (error) {
      optimizationFailure(res, error);
    }
  });

  return router;
}

function safeErrorForOptimizationLog(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: (error as { code?: unknown }).code };
  }
  return error;
}
