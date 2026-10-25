import { createHash } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { isAbsolute, join, resolve } from "node:path";
import {
  fingerprintLogic,
  type LogicSections,
} from "../contracts/response-logic-evaluation.js";
import {
  judgeOutputSchema,
  judgeEvaluationEnvelopeSchema,
  verifyDraftExcerpt,
  recomputeCompletenessScore,
  recomputeActionabilityScore,
  recomputeBoundaryRiskScore,
  type JudgeOutput,
} from "../contracts/response-logic-judge.js";
import type { ResponseLogicRecordDto } from "../contracts/response-logic.js";
import type { CoreRequest, ManusV2MessageEvent, ResponseLogicApiPorts } from "./task-ports.js";
import { buildDirectorySkillArchive } from "./directory-skill-archive.js";

/**
 * LLM-as-Judge evaluation of one response-logic draft.
 *
 * Mounted by createResponseLogicApi under /evaluation/judge, sharing the
 * host's existing /api/response-logic mount. The Judge runs as an async
 * model task: POST creates the task, GET polls for the result.
 *
 * Task ownership uses the existing upstream_resources table (recordUpstreamResource
 * on create, getCredentialForUpstreamResource on poll) — the same database-backed
 * mechanism as generation tasks. The Judge deliberately does NOT set lastTaskId
 * on response_logic_entries to avoid interfering with the generation task slot.
 *
 * Score consistency is enforced server-side: completeness, actionability, and
 * boundaryRisk scores are recomputed from the model's sub-items and must match.
 * Draft evidence excerpts are verified as contiguous substrings of the evaluated
 * draft. Any mismatch rejects the output with a diagnostic error.
 */

const JUDGE_STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  properties: { payload: { type: "string" } },
  required: ["payload"],
  additionalProperties: false,
} as const;

const JUDGE_SKILL_ATTACHMENT_FILENAME = "response-logic-evaluator.skill.zip";
const JUDGE_TURN_INPUT_ATTACHMENT_FILENAME = "response-logic-judge-turn-input.zip";
const JUDGE_EVIDENCE_ATTACHMENT_FILENAME = "response-logic-judge-evidence.zip";

type EvaluationCore = Pick<
  ResponseLogicApiPorts,
  | "enterpriseWorkspaceUserId"
  | "assertServiceCapability"
  | "ServiceEntitlementError"
  | "sendAiBillingError"
  | "getDashboardQuestion"
  | "getResponseLogicEntry"
  | "credentialForRequest"
  | "getFrontMindCredentials"
  | "createCredentialAgentClient"
  | "getUpstreamBaseUrl"
  | "toUpstreamAgentProfile"
  | "getCredentialForUpstreamResource"
  | "recordUpstreamResource"
  | "getLatestKnowledgeSnapshot"
  | "buildDeterministicTaskAttachmentArchive"
  | "classifyManusV2StructuredResultEnvelope"
  | "latestManusV2TaskState"
  | "orderManusV2EventsByProviderRank"
  | "ManusV2ApiError"
  | "assertUpstreamPromptBudget"
> & {
  /** Compact knowledge snapshot for the evidence archive (same shape as generation). */
  getLatestKnowledgeSnapshot: ResponseLogicApiPorts["getLatestKnowledgeSnapshot"];
};

type KnowledgeSnapshotForJudge = Awaited<ReturnType<EvaluationCore["getLatestKnowledgeSnapshot"]>>;

const judgeStartInputSchema = z
  .object({
    questionId: z.string().trim().min(1).max(191),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

const judgeStatusQuerySchema = z
  .object({
    questionId: z.string().trim().min(1).max(191),
    expectedRevision: z.coerce.number().int().positive(),
  })
  .strict();

function judgeError(res: Response, status: number, code: string, message: string) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: { code, message } });
}

/**
 * Idempotency key binds the task to the FULL evaluation context:
 * user + question + record revision + draft fingerprint + skill version +
 * knowledge fingerprint. Any context change (draft edit, knowledge update,
 * skill upgrade) produces a different key, preventing stale task reuse.
 */
function judgeIdempotencyKey(input: {
  userId: number;
  questionId: string;
  recordRevision: number;
  sourceFingerprint: string;
  skillContentHash: string;
  knowledgeFingerprint: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "frontmind-response-logic-judge-v2",
        input.userId,
        input.questionId,
        input.recordRevision,
        input.sourceFingerprint,
        input.skillContentHash,
        input.knowledgeFingerprint,
      ]),
      "utf8",
    )
    .digest("hex");
}

/* ---------------------------------------------------------------------------
 * Input construction
 * ------------------------------------------------------------------------- */

const configuredJudgeSkillPath =
  process.env.FRONTMIND_RESPONSE_LOGIC_JUDGE_SKILL_PATH?.trim();

/**
 * Candidate directories for the evaluator Skill, in priority order — same
 * semantics as the builder/brand Skill paths (FRONTMIND_*_SKILL_PATH must be
 * absolute and, when set, is the ONLY candidate so a bad value fails loudly
 * instead of silently loading another copy).
 */
export function judgeSkillDirectoryCandidates(configuredPath: string | undefined): string[] {
  if (configuredPath) return [configuredPath];
  return [
    join(import.meta.dirname, "../workflows/response-logic-evaluator.skill"),
    join(process.cwd(), "modules/intent/workflows/response-logic-evaluator.skill"),
    join(process.cwd(), "private-workflows/response-logic-evaluator.skill"),
    // Assembled runtime images run from /app/apps/dashboard while the module
    // checkout (including module/workflows) lives under /app/module-build.
    resolve(process.cwd(), "../../module-build/module/workflows/response-logic-evaluator.skill"),
  ];
}

export async function buildJudgeSkillArchive(configuredPath: string | undefined = configuredJudgeSkillPath) {
  // Validated lazily on purpose: a misconfigured judge-only env key must fail
  // this endpoint with a clear diagnostic, not prevent the whole service
  // (questions, editing, internal rule diagnostics) from booting.
  if (configuredPath && !isAbsolute(configuredPath)) {
    throw new Error(`FRONTMIND_RESPONSE_LOGIC_JUDGE_SKILL_PATH must be an absolute path (got: ${configuredPath})`);
  }
  const skillDirectoryCandidates = judgeSkillDirectoryCandidates(configuredPath);
  try {
    return await buildDirectorySkillArchive({
      name: "response-logic-evaluator",
      version: "1",
      directoryCandidates: skillDirectoryCandidates,
      files: ["SKILL.md", "references/output-contract.md", "references/rubric.md"],
    });
  } catch (error) {
    throw new Error(
      `Could not load Skill response-logic-evaluator (tried: ${skillDirectoryCandidates.join("; ")})`,
      { cause: error },
    );
  }
}

type JudgeTurnInput = {
  questionId: string;
  question: string;
  intent: string;
  record: ResponseLogicRecordDto;
  knowledgeSnapshot: KnowledgeSnapshotForJudge;
  evidenceFilename: string | null;
  skillFilename: string;
  idempotencyKey: string;
};

async function buildJudgeTurnInputArchive(
  core: EvaluationCore,
  input: JudgeTurnInput,
) {
  const logic: LogicSections = {
    concern: input.record.draft.concern,
    conclusion: input.record.draft.conclusion,
    facts: input.record.draft.facts,
    boundaries: input.record.draft.boundaries,
  };
  return core.buildDeterministicTaskAttachmentArchive({
    name: "response-logic-judge-turn-input",
    entrypoint: "turn-input.json",
    files: [
      {
        path: "turn-input.json",
        content: `${JSON.stringify(
          {
            schemaVersion: 1,
            kind: "frontmind.response-logic.judge-input",
            question: {
              id: input.questionId,
              text: input.question,
              intent: input.intent,
              answerGoal: input.record.summary,
            },
            currentDraft: logic,
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
                    "知识库不可用。不得编造企业事实；知识相关判断标记 evidenceConfidence 为 unverifiable。",
                },
            outputContract: {
              format: "manus_v2_structured_output",
              requiredFields: ["payload"],
              payloadIsJSON: true,
              uncertaintyMarking: "evidenceConfidence: supported | partial | unverifiable",
              noAggregateScore: true,
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

function buildJudgePrompt(input: {
  skillFilename: string;
  turnInputFilename: string;
  evidenceFilename: string | null;
  hasKnowledge: boolean;
}) {
  const evidenceInstruction = input.hasKnowledge
    ? `解压并读取附件 ${input.evidenceFilename} 中的 knowledge.md，仅可引用其中实际存在的企业事实和材料路径。`
    : "知识库不可用。不得编造企业事实；知识相关判断标记 evidenceConfidence 为 unverifiable。";
  return `严格执行首次任务附件 ${input.skillFilename}；先解压并完整读取 SKILL.md、references/output-contract.md 和 references/rubric.md。
必须解压附件 ${input.turnInputFilename} 并完整读取 turn-input.json。它是当前问题、草稿、知识库身份与输出约束的唯一服务端权威输入。
${evidenceInstruction}
按照 turn-input.json 中 outputContract 的要求，对 currentDraft 的四个维度进行语义质量评估。把完整评估结果序列化为严格 JSON，装入 v2 structured output 的 payload 字符串字段。四维 key 分别为 relevance、completeness、actionability、boundaryRisk。不输出综合分数。`;
}

/* ---------------------------------------------------------------------------
 * Result parsing and validation
 * ------------------------------------------------------------------------- */

function parseJudgePayload(events: ReadonlyArray<ManusV2MessageEvent>): {
  ok: true;
  judge: JudgeOutput;
} | {
  ok: false;
  code: string;
  message: string;
} {
  for (const event of [...events].sort(
    (a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id),
  )) {
    if (event.type !== "structured_output_result") continue;
    const value = (event as { structured_output_result?: unknown }).structured_output_result;
    if (typeof value !== "object" || value === null) continue;
    const payload = (value as { payload?: unknown }).payload;
    if (typeof payload !== "string") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { ok: false, code: "JUDGE_PAYLOAD_INVALID_JSON", message: "Judge 输出的 payload 不是有效 JSON" };
    }

    const schemaResult = judgeOutputSchema.safeParse(parsed);
    if (!schemaResult.success) {
      return { ok: false, code: "JUDGE_OUTPUT_SCHEMA_MISMATCH", message: `Judge 输出未通过 Schema 校验: ${schemaResult.error.issues[0]?.path.join(".")} — ${schemaResult.error.issues[0]?.message}` };
    }
    return { ok: true, judge: schemaResult.data };
  }
  return { ok: false, code: "JUDGE_STRUCTURED_OUTPUT_MISSING", message: "Judge 任务未返回结构化输出" };
}

function validateJudgeConsistency(
  judge: JudgeOutput,
  logic: LogicSections,
  knowledgeContent: string | null,
): { ok: true } | { ok: false; code: string; message: string } {
  // Score recomputation
  const completenessExpected = recomputeCompletenessScore(judge);
  if (completenessExpected !== null) {
    return {
      ok: false,
      code: "JUDGE_SCORE_INCONSISTENT",
      message: `完整性分数 ${judge.dimensions.completeness.score} 与覆盖状态复算 ${completenessExpected} 不一致`,
    };
  }
  const actionabilityExpected = recomputeActionabilityScore(judge);
  if (actionabilityExpected !== null) {
    return {
      ok: false,
      code: "JUDGE_SCORE_INCONSISTENT",
      message: `可执行性分数 ${judge.dimensions.actionability.score} 与子维度复算 ${actionabilityExpected} 不一致`,
    };
  }
  const boundaryExpected = recomputeBoundaryRiskScore(judge);
  if (boundaryExpected !== null) {
    return {
      ok: false,
      code: "JUDGE_SCORE_INCONSISTENT",
      message: `边界与风险控制分数 ${judge.dimensions.boundaryRisk.score} 与风险状态复算 ${boundaryExpected} 不一致`,
    };
  }
  // The recompute helper cannot express this case: with no scoreable risk
  // items its expected value is null, which the caller reads as "consistent".
  // A numeric score here would render as a real score (e.g. a fabricated 100)
  // instead of 未评估, so reject it explicitly.
  if (
    judge.dimensions.boundaryRisk.score !== null &&
    !judge.dimensions.boundaryRisk.risks.some(
      (risk) => risk.status === "controlled" || risk.status === "partial" || risk.status === "uncontrolled",
    )
  ) {
    return {
      ok: false,
      code: "JUDGE_SCORE_INCONSISTENT",
      message: "边界与风险控制无可计分的适用风险项，分数必须为 null（未评估），不得给出数字分",
    };
  }

  // Evidence excerpt verification
  const excerptResult = verifyDraftExcerpt(judge, logic);
  if (excerptResult.invalid > 0) {
    return {
      ok: false,
      code: "JUDGE_EVIDENCE_EXCERPT_INVALID",
      message: `${excerptResult.invalid} 条草稿证据摘录未在应答逻辑原文中找到: ${excerptResult.invalidExcerpts[0] ?? ""}`,
    };
  }

  // Knowledge evidence verification
  const knowledgeResult = verifyKnowledgeEvidence(judge, knowledgeContent);
  if (knowledgeResult !== null) {
    return knowledgeResult;
  }

  return { ok: true };
}

/**
 * Verify that knowledge-sourced evidence is honest:
 * - When no knowledge snapshot was provided, ANY finding claiming
 *   evidenceSource="knowledge" is invalid (the model fabricated a citation).
 * - When knowledge is available, the excerpt must appear in the actual
 *   knowledge document content.
 */
function verifyKnowledgeEvidence(
  judge: JudgeOutput,
  knowledgeContent: string | null,
): { ok: false; code: string; message: string } | null {
  const collect = (findings: Array<{ evidenceSource: string; evidence: string }>): string[] => {
    return findings
      .filter((f) => f.evidenceSource === "knowledge" && f.evidence)
      .map((f) => f.evidence);
  };

  const excerpts: string[] = [
    ...collect(judge.dimensions.relevance.findings),
    ...judge.dimensions.completeness.coverage.flatMap((c) => collect(c.findings)),
    ...collect(judge.dimensions.completeness.findings),
    ...judge.dimensions.actionability.subMetrics.flatMap((s) => collect(s.findings)),
    ...collect(judge.dimensions.actionability.findings),
    ...judge.dimensions.boundaryRisk.risks.flatMap((r) => collect(r.findings)),
    ...collect(judge.dimensions.boundaryRisk.findings),
  ];

  if (excerpts.length === 0) return null;

  if (knowledgeContent === null) {
    return {
      ok: false,
      code: "JUDGE_KNOWLEDGE_EVIDENCE_UNAVAILABLE",
      message: `${excerpts.length} 条知识证据在知识库不可用时被引用（模型不应编造知识引用）: ${excerpts[0]?.slice(0, 50) ?? ""}`,
    };
  }

  const invalid = excerpts.filter((e) => !knowledgeContent.includes(e));
  if (invalid.length > 0) {
    return {
      ok: false,
      code: "JUDGE_KNOWLEDGE_EVIDENCE_INVALID",
      message: `${invalid.length} 条知识证据摘录未在知识材料中找到: ${invalid[0]?.slice(0, 50) ?? ""}`,
    };
  }

  return null;
}

/** Compact knowledge snapshot into a single searchable text (same approach as generation evidence). */
function compactKnowledgeForVerification(snapshot: NonNullable<KnowledgeSnapshotForJudge>): string {
  return snapshot.documents
    .map((doc) => doc.content)
    .join("\n\n");
}

/* ---------------------------------------------------------------------------
 * Router factory
 * ------------------------------------------------------------------------- */

export function createResponseLogicJudgeRouter(core: EvaluationCore): import("express").Router {
  const router = Router();

  /** Shared prologue: auth, capability, configured question, record, revision. */
  async function resolveContext(
    req: CoreRequest,
    res: Response,
    questionId: string,
    expectedRevision?: number,
  ): Promise<{
    record: ResponseLogicRecordDto;
    workspaceUserId: number;
    logic: LogicSections;
    fingerprint: string;
  } | null> {
    const user = req.frontmindUser;
    if (!user) {
      judgeError(res, 401, "UNAUTHORIZED", "请先登录");
      return null;
    }
    const workspaceUserId = core.enterpriseWorkspaceUserId(user.id);
    await core.assertServiceCapability(workspaceUserId, "responseLogic");
    const configuredQuestion = await core.getDashboardQuestion(workspaceUserId, questionId);
    if (!configuredQuestion) {
      judgeError(res, 422, "RESPONSE_LOGIC_QUESTION_NOT_CONFIGURED", "当前问题尚未由管理员配置");
      return null;
    }
    const record = await core.getResponseLogicEntry(workspaceUserId, questionId);
    if (!record) {
      judgeError(res, 404, "RESPONSE_LOGIC_RECORD_MISSING", "当前问题还没有应答逻辑内容");
      return null;
    }
    if (expectedRevision !== undefined && expectedRevision !== record.revision) {
      res.setHeader("Cache-Control", "no-store");
      res.status(409).json({
        error: {
          code: "RESPONSE_LOGIC_REVISION_CONFLICT",
          message: `应答逻辑已更新到 R${record.revision}，当前请求基于 R${expectedRevision}；请刷新后重试`,
          actualRevision: record.revision,
        },
      });
      return null;
    }
    const logic: LogicSections = {
      concern: record.draft.concern,
      conclusion: record.draft.conclusion,
      facts: record.draft.facts,
      boundaries: record.draft.boundaries,
    };
    return {
      record,
      workspaceUserId,
      logic,
      fingerprint: fingerprintLogic(logic),
    };
  }

  function judgeFailure(res: Response, error: unknown) {
    if (core.sendAiBillingError(res, error)) return;
    if (error instanceof core.ServiceEntitlementError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "DATABASE_UNAVAILABLE") {
      judgeError(res, 503, "DATABASE_UNAVAILABLE", "评估服务暂时不可用");
      return;
    }
    console.error("[Response Logic Judge] error:", error);
    judgeError(res, 500, "RESPONSE_LOGIC_JUDGE_FAILED", "Judge 请求失败");
  }

  /* -- POST / (start) -- */

  router.post("/", async (request, res) => {
    const req = request as CoreRequest;
    try {
      const parsed = judgeStartInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        judgeError(res, 400, "INVALID_RESPONSE_LOGIC_JUDGE_INPUT", "Judge 请求格式不完整");
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

      // Question text/intent for the Judge turn-input (the LLM is the sole
      // formal scorer — the rule engine never feeds this request).
      const configuredQuestion = await core.getDashboardQuestion(workspaceUserId, parsed.data.questionId);

      // Knowledge snapshot
      const knowledgeSnapshot = await core.getLatestKnowledgeSnapshot(workspaceUserId);

      // Build evidence archive first (if knowledge exists) so its filename
      // can be referenced consistently in both turn-input and prompt.
      let evidenceUploadFilename: string | null = null;
      let evidenceArchiveBytes: Buffer | null = null;
      if (knowledgeSnapshot) {
        const evidenceContent = compactKnowledgeForVerification(knowledgeSnapshot);
        const evidenceArchive = await core.buildDeterministicTaskAttachmentArchive({
          name: "response-logic-judge-evidence",
          entrypoint: "knowledge.md",
          files: [
            {
              path: "context.json",
              content: `${JSON.stringify({ schemaVersion: 1, knowledgeSnapshot: { version: knowledgeSnapshot.version, sourceFileName: knowledgeSnapshot.sourceFileName } }, null, 2)}\n`,
            },
            { path: "knowledge.md", content: evidenceContent },
          ],
        });
        evidenceUploadFilename = `${JUDGE_EVIDENCE_ATTACHMENT_FILENAME.replace(".zip", "")}-${evidenceArchive.contentHash.slice(0, 12)}.zip`;
        evidenceArchiveBytes = evidenceArchive.bytes;
      }

      // Skill archive
      const skillArchive = await buildJudgeSkillArchive();
      const skillFilename = `${JUDGE_SKILL_ATTACHMENT_FILENAME.replace(".zip", "")}-${skillArchive.contentHash}.zip`;

      // Turn-input archive
      const turnInputArchive = await buildJudgeTurnInputArchive(core, {
        questionId: parsed.data.questionId,
        question: configuredQuestion?.question ?? record.question,
        intent: configuredQuestion?.intent ?? record.intent,
        record,
        knowledgeSnapshot,
        evidenceFilename: evidenceUploadFilename,
        skillFilename,
        idempotencyKey: "",
      });
      const turnInputFilename = `${JUDGE_TURN_INPUT_ATTACHMENT_FILENAME.replace(".zip", "")}-${turnInputArchive.contentHash}.zip`;

      // Prompt
      const prompt = core.assertUpstreamPromptBudget(
        buildJudgePrompt({
          skillFilename,
          turnInputFilename,
          evidenceFilename: evidenceUploadFilename,
          hasKnowledge: Boolean(knowledgeSnapshot),
        }),
      );

      // Idempotency key — includes full context (revision + knowledge fingerprint)
      // so that any context change produces a different key, preventing stale
      // task reuse across draft edits or knowledge snapshot updates.
      const knowledgeFingerprint = knowledgeSnapshot
        ? createHash("sha256")
            .update(knowledgeSnapshot.documents.map((doc) => doc.content).join("\n"), "utf8")
            .digest("hex")
        : "none";
      const idemKey = judgeIdempotencyKey({
        userId: workspaceUserId,
        questionId: parsed.data.questionId,
        recordRevision: record.revision,
        sourceFingerprint: fingerprint,
        skillContentHash: skillArchive.contentHash,
        knowledgeFingerprint,
      });

      // Create task
      const client = core.createCredentialAgentClient(requestCredential, {
        baseUrl: core.getUpstreamBaseUrl(request),
        accountUserId: workspaceUserId,
        intentId: idemKey,
        rateLimitScope: `managed-user:${workspaceUserId}`,
      });

      // Upload skill, turn-input, and evidence (if knowledge available)
      const attachments: Array<{ file_id: string; filename: string }> = [];
      const skillUpload = await client.uploadFile({
        filename: skillFilename,
        bytes: skillArchive.bytes,
        contentType: "application/zip",
      });
      attachments.push({ file_id: skillUpload.fileId, filename: skillFilename });

      const turnInputUpload = await client.uploadFile({
        filename: turnInputFilename,
        bytes: turnInputArchive.bytes,
        contentType: "application/zip",
      });
      attachments.push({ file_id: turnInputUpload.fileId, filename: turnInputFilename });

      if (evidenceUploadFilename && evidenceArchiveBytes) {
        const evidenceUpload = await client.uploadFile({
          filename: evidenceUploadFilename,
          bytes: evidenceArchiveBytes,
          contentType: "application/zip",
        });
        attachments.push({ file_id: evidenceUpload.fileId, filename: evidenceUploadFilename });
      }

      const created = await client.createTask({
        prompt: `${prompt}\n\nFRONTMIND_MANUS_V2_OPERATION_CONTRACT=${JSON.stringify({ operationToken: idemKey })}`,
        attachments,
        title: `FrontMind judge ${idemKey.slice(0, 24)}`,
        agentProfile: core.toUpstreamAgentProfile(requestCredential.agentProfile),
        locale: "zh-CN",
        interactiveMode: false,
        structuredOutputSchema: JUDGE_STRUCTURED_OUTPUT_SCHEMA,
      });

      // Record ownership — kind must be "task" (MySQL ENUM in upstream_resources
      // only accepts "task" | "file"). Context binding is enforced via the
      // idempotency key (which includes revision + fingerprint + knowledge hash)
      // and the revision check on the status endpoint.
      try {
        await core.recordUpstreamResource({
          userId: workspaceUserId,
          apiCredentialId: requestCredential.id,
          kind: "task",
          upstreamId: created.taskId,
        });
      } catch (bindingError) {
        console.error("[Response Logic Judge] task binding pending:", {
          taskId: created.taskId,
          error: bindingError,
        });
        res.status(502).json({
          error: {
            code: "RESPONSE_LOGIC_JUDGE_BINDING_PENDING",
            message: "Judge 任务已创建，但本地绑定未完成；请重置后重新开始",
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
        knowledgeFingerprint,
        judgeVersion: "1",
      });
    } catch (error) {
      judgeFailure(res, error);
    }
  });

  /* -- GET /tasks/:taskId/status -- */

  router.get("/tasks/:taskId/status", async (request, res) => {
    const req = request as CoreRequest;
    try {
      const parsed = judgeStatusQuerySchema.safeParse(req.query);
      const taskId = String(req.params.taskId || "").trim();
      if (!taskId || taskId.length > 255 || !parsed.success) {
        judgeError(res, 400, "INVALID_RESPONSE_LOGIC_JUDGE_INPUT", "缺少当前问题、版本或任务标识");
        return;
      }
      const ctx = await resolveContext(req, res, parsed.data.questionId, parsed.data.expectedRevision);
      if (!ctx) return;
      const { record, workspaceUserId, logic, fingerprint } = ctx;

      // Task ownership: verify via upstream_resources (database-backed).
      // Context binding is enforced by the revision check above plus the
      // idempotency key (which includes the full context fingerprint).
      const credential = await core.getCredentialForUpstreamResource(workspaceUserId, "task", taskId);
      if (!credential) {
        judgeError(res, 403, "RESPONSE_LOGIC_JUDGE_TASK_FORBIDDEN", "当前 Judge 任务不属于此账号");
        return;
      }

      // Poll upstream
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
        judgeError(res, 422, "RESPONSE_LOGIC_JUDGE_TASK_FAILED", "Judge 任务执行失败");
        return;
      }
      if (status !== "stopped") {
        judgeError(res, 502, "RESPONSE_LOGIC_JUDGE_STATUS_INVALID", "Judge 任务返回了无法识别的状态");
        return;
      }

      // Parse and validate structured output
      const parsedResult = parseJudgePayload(events);
      if (!parsedResult.ok) {
        judgeError(res, 422, parsedResult.code, parsedResult.message);
        return;
      }

      // Score consistency + evidence verification (including knowledge evidence)
      const knowledgeSnapshot = await core.getLatestKnowledgeSnapshot(workspaceUserId);
      const knowledgeContent = knowledgeSnapshot ? compactKnowledgeForVerification(knowledgeSnapshot) : null;
      const consistency = validateJudgeConsistency(parsedResult.judge, logic, knowledgeContent);
      if (!consistency.ok) {
        judgeError(res, 422, consistency.code, consistency.message);
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json(
        judgeEvaluationEnvelopeSchema.parse({
          status: "completed",
          judgeVersion: "1",
          recordRevision: record.revision,
          sourceFingerprint: fingerprint,
          evaluatedAt: new Date().toISOString(),
          judge: parsedResult.judge,
        }),
      );
    } catch (error) {
      judgeFailure(res, error);
    }
  });

  return router;
}
