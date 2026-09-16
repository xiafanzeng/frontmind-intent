import {createHash,randomUUID} from "node:crypto";
import {and,asc,eq} from "drizzle-orm";
import {workspaceQuestionCategorySchema,type ServicePortalQuestion,type WorkspaceQuestionCategory} from "../contracts/questions.js";
import type {IntentSchema,WorkspaceQuestionEvidenceRecord} from "../schema/index.js";
import type {IntentDatabase,IntentTransaction} from "./response-logic-service.js";
type WorkspaceQuestion=IntentSchema["workspaceQuestions"]["$inferSelect"];
export type GeneratedQuestionCandidate = {
  candidateKey?: string;
  externalQuestionId?: string | null;
  category: WorkspaceQuestionCategory;
  question: string;
  intent?: string | null;
  rationale?: string | null;
  evidence?: WorkspaceQuestionEvidenceRecord[];
  risks?: string[];
};

export type ReplaceGeneratedQuestionCandidatesInput = {
  userId: number;
  quotaPeriodId: string;
  candidates: GeneratedQuestionCandidate[];
  sourceTaskId: string;
  knowledgeSnapshotId?: string | null;
  expectedQuotaContext: {
    revision: number;
    remaining: {
      industry: number;
      competitorComparison: number;
      reputation: number;
      productScenario: number;
    };
  };
};


export interface GeneratedQuestionPorts {
 workspaceQuestions:IntentSchema["workspaceQuestions"];
 requireServiceDb():Promise<IntentDatabase>;
 ServiceEntitlementError:new(code:"QUESTION_GENERATION_CONFLICT",message:string,statusCode?:number)=>Error;
 lockGenerationScope(tx:IntentTransaction,input:ReplaceGeneratedQuestionCandidatesInput,now:Date):Promise<{period:{contractId:string};questionStoragePeriod:{id:string}}>;
 publicQuestion(row:WorkspaceQuestion):ServicePortalQuestion;
}
export function createGeneratedQuestionService(ports:GeneratedQuestionPorts) {
 const {workspaceQuestions,requireServiceDb,ServiceEntitlementError}=ports;
function normalizeCandidateText(value: string, field: string, max: number) {
  const normalized = String(value ?? "")
    .normalize("NFC")
    .trim();
  if (!normalized || normalized.length > max) {
    throw new ServiceEntitlementError(
      "QUESTION_GENERATION_CONFLICT",
      `${field}无效。`,
      400,
    );
  }
  return normalized;
}

function normalizeOptionalCandidateText(
  value: string | null | undefined,
  field: string,
  max: number,
) {
  return value == null || !value.trim()
    ? null
    : normalizeCandidateText(value, field, max);
}

function candidateKey(candidate: GeneratedQuestionCandidate) {
  const provided = candidate.candidateKey?.trim();
  if (provided) return normalizeCandidateText(provided, "候选问题标识", 191);
  return createHash("sha256")
    .update(
      `${candidate.category}\0${candidate.question.normalize("NFKC").trim()}`,
    )
    .digest("hex");
}

function normalizeGeneratedQuestionCandidates(
  values: GeneratedQuestionCandidate[],
) {
  if (!values.length) {
    throw new ServiceEntitlementError(
      "QUESTION_GENERATION_CONFLICT",
      "候选问题不能为空。",
      400,
    );
  }
  const candidates = values.map((candidate, ordinal) => {
    const category = workspaceQuestionCategorySchema.safeParse(
      candidate.category,
    );
    if (!category.success) {
      throw new ServiceEntitlementError(
        "QUESTION_GENERATION_CONFLICT",
        "候选问题类型无效。",
        400,
      );
    }
    if ((candidate.evidence?.length ?? 0) > 100) {
      throw new ServiceEntitlementError(
        "QUESTION_GENERATION_CONFLICT",
        "单个候选问题最多保留 100 条证据。",
        400,
      );
    }
    const evidence = (candidate.evidence ?? []).map((item) => ({
      documentPath: normalizeCandidateText(
        item.documentPath,
        "证据文档路径",
        1_024,
      ),
      excerpt: normalizeCandidateText(item.excerpt, "证据摘录", 8_000),
      relevance: normalizeCandidateText(item.relevance, "证据关联说明", 2_000),
    }));
    if ((candidate.risks?.length ?? 0) > 100) {
      throw new ServiceEntitlementError(
        "QUESTION_GENERATION_CONFLICT",
        "单个候选问题最多保留 100 条风险说明。",
        400,
      );
    }
    const risks = (candidate.risks ?? []).map((risk) =>
      normalizeCandidateText(risk, "风险说明", 2_000),
    );
    return {
      candidateKey: candidateKey(candidate),
      externalQuestionId: normalizeOptionalCandidateText(
        candidate.externalQuestionId,
        "外部问题标识",
        191,
      ),
      category: category.data,
      question: normalizeCandidateText(candidate.question, "候选问题", 4_000),
      intent: normalizeOptionalCandidateText(
        candidate.intent,
        "问题意图",
        16_000,
      ),
      rationale: normalizeOptionalCandidateText(
        candidate.rationale,
        "推荐理由",
        16_000,
      ),
      evidence,
      risks,
      ordinal,
    };
  });
  if (
    new Set(candidates.map((item) => item.candidateKey)).size !==
    candidates.length
  ) {
    throw new ServiceEntitlementError(
      "QUESTION_GENERATION_CONFLICT",
      "同一批次包含重复的候选问题。",
      400,
    );
  }
  return candidates;
}

function evidenceSignature(
  evidence: WorkspaceQuestionEvidenceRecord[] | null | undefined,
) {
  return JSON.stringify(
    (evidence ?? []).map((item) => ({
      documentPath: item.documentPath,
      excerpt: item.excerpt,
      relevance: item.relevance,
    })),
  );
}

function isReplaceableModelCandidate(
  question: Pick<
    WorkspaceQuestion,
    "source" | "status" | "selectionApprovalStatus" | "locked"
  >,
): boolean {
  return (
    question.source === "model" &&
    question.status === "candidate" &&
    question.selectionApprovalStatus === "not_requested" &&
    !question.locked
  );
}

async function replaceGeneratedQuestionCandidates(
  input: ReplaceGeneratedQuestionCandidatesInput,
): Promise<ServicePortalQuestion[]> {
  const db = await requireServiceDb();
  const sourceTaskId = normalizeCandidateText(
    input.sourceTaskId,
    "生成任务标识",
    255,
  );
  const candidates = normalizeGeneratedQuestionCandidates(input.candidates);
  const now = new Date();

  return db.transaction(async (tx) => {
    const {period, questionStoragePeriod} = await ports.lockGenerationScope(tx, input, now);
    const sameTaskRows = await tx
      .select()
      .from(workspaceQuestions)
      .where(
        and(
          eq(workspaceQuestions.userId, input.userId),
          eq(workspaceQuestions.quotaPeriodId, questionStoragePeriod.id),
          eq(workspaceQuestions.sourceTaskId, sourceTaskId),
          eq(workspaceQuestions.source, "model"),
        ),
      )
      .orderBy(asc(workspaceQuestions.ordinal))
      .for("update");
    if (sameTaskRows.length) {
      const same =
        sameTaskRows.length === candidates.length &&
        sameTaskRows.every((row, index) => {
          const candidate = candidates[index];
          return (
            row.candidateKey === candidate.candidateKey &&
            row.category === candidate.category &&
            row.question === candidate.question &&
            row.intent === candidate.intent &&
            row.rationale === candidate.rationale &&
            evidenceSignature(row.evidence) ===
              evidenceSignature(candidate.evidence) &&
            JSON.stringify(row.risks) === JSON.stringify(candidate.risks)
          );
        });
      if (!same) {
        throw new ServiceEntitlementError(
          "QUESTION_GENERATION_CONFLICT",
          "该生成任务已绑定另一组候选问题。",
        );
      }
      return sameTaskRows.map(ports.publicQuestion);
    }

    const replaceableRows = await tx
      .select({
        id: workspaceQuestions.id,
        revision: workspaceQuestions.revision,
      })
      .from(workspaceQuestions)
      .where(
        and(
          eq(workspaceQuestions.userId, input.userId),
          eq(workspaceQuestions.quotaPeriodId, questionStoragePeriod.id),
          eq(workspaceQuestions.source, "model"),
          eq(workspaceQuestions.status, "candidate"),
          eq(workspaceQuestions.selectionApprovalStatus, "not_requested"),
          eq(workspaceQuestions.locked, false),
        ),
      )
      .for("update");
    const archivedAt = new Date();
    for (const row of replaceableRows) {
      await tx
        .update(workspaceQuestions)
        .set({
          status: "archived",
          archivedAt,
          revision: row.revision + 1,
          updatedAt: archivedAt,
        })
        .where(eq(workspaceQuestions.id, row.id));
    }

    const rows: WorkspaceQuestion[] = candidates.map((candidate) => ({
      id: randomUUID(),
      userId: input.userId,
      contractId: period.contractId,
      quotaPeriodId: questionStoragePeriod.id,
      externalQuestionId: candidate.externalQuestionId,
      sourceQuestionId: null,
      candidateKey: candidate.candidateKey,
      category: candidate.category,
      question: candidate.question,
      intent: candidate.intent,
      intentRevision: 1,
      intentConfirmedRevision: null,
      intentConfirmedAt: null,
      intentConfirmedByUserId: null,
      rationale: candidate.rationale,
      evidence: candidate.evidence,
      risks: candidate.risks,
      source: "model",
      status: "candidate",
      selectionApprovalStatus: "not_requested",
      selectionRequestedAt: null,
      selectionRequestedByUserId: null,
      selectionApprovedAt: null,
      selectionApprovedByUserId: null,
      locked: false,
      sourceTaskId,
      knowledgeSnapshotId: input.knowledgeSnapshotId ?? null,
      ordinal: candidate.ordinal,
      revision: 1,
      selectedAt: null,
      archivedAt: null,
      createdByUserId: null,
      createdAt: archivedAt,
      updatedAt: archivedAt,
    }));
    await tx.insert(workspaceQuestions).values(rows);
    return rows.map(ports.publicQuestion);
  });
}

return {normalizeCandidateText,normalizeOptionalCandidateText,normalizeGeneratedQuestionCandidates,isReplaceableModelCandidate,replaceGeneratedQuestionCandidates};
}
