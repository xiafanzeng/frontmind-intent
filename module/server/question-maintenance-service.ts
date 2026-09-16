import { createHash } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { IntentSchema } from "../schema/index.js";
import type { IntentDatabase, IntentTransaction } from "./response-logic-service.js";
export interface IntentActor { id: number; role: string; username: string }
export interface QuestionMaintenancePorts<Actor extends IntentActor> {
  tables: IntentSchema;
  getDb(): Promise<IntentDatabase | null>;
  AuthServiceError: new (code: "DATABASE_UNAVAILABLE" | "CONFLICT" | "NOT_FOUND" | "INVALID_CREDENTIAL", message: string) => Error & { readonly code: string };
  getEnterpriseProjectScope(): { isLegacyDefault: boolean; enterpriseProjectId: string } | undefined;
  enterpriseWorkspaceUserId(actorId: number): number;
  workspaceQuestionTable(): IntentSchema["workspaceQuestions"];
  workspaceQuestionOwnerPredicate(userId: number): SQL;
  enterpriseOwnerPredicate(table: IntentSchema["responseLogicEntries"], userId: number): SQL;
  assertCustomerProjectBusinessWrite(actor: Actor, userId: number): Promise<unknown>;
  lockCustomerProjectBusinessWrite(tx: IntentTransaction, userId: number, actor: Actor): Promise<unknown>;
  assertServiceWriteAccess(userId: number): Promise<{ purchasedQuestions: Array<{ id: string; contractId: string | null; quotaPeriodId: string }> }>;
  lockOwner(tx: IntentTransaction, userId: number): Promise<void>;
  readAudit(tx: IntentTransaction, userId: number, operationId: string): Promise<{ metadata: Record<string, unknown> } | undefined>;
  writeAudit(tx: IntentTransaction, input: {
    operationId: string; userId: number; actor: Actor; action: ApplyQuestionMaintenanceInput["action"];
    questionId: string; reason?: string; requestHash: string; result: QuestionMaintenanceResult; now: Date;
  }): Promise<void>;
}

const base = z.object({
  clientRequestId: z.string().uuid(),
  questionId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().max(2_000).optional(),
});
export const applyQuestionMaintenanceSchema = z.discriminatedUnion("action", [
  base
    .extend({
      action: z.literal("modify"),
      proposedQuestion: z.string().trim().min(2).max(4_000),
    })
    .strict(),
  base.extend({ action: z.literal("delete") }).strict(),
  base
    .extend({
      action: z.literal("response_logic_reset"),
      expectedResponseLogicRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type ApplyQuestionMaintenanceInput = z.infer<
  typeof applyQuestionMaintenanceSchema
>;
export type QuestionMaintenanceResult = {
  action: ApplyQuestionMaintenanceInput["action"];
  questionId: string;
  replacementQuestionId: string | null;
};

export function createQuestionMaintenanceService<Actor extends IntentActor>(ports: QuestionMaintenancePorts<Actor>) {
  const { getDb, AuthServiceError, getEnterpriseProjectScope, enterpriseWorkspaceUserId, workspaceQuestionTable, workspaceQuestionOwnerPredicate, enterpriseOwnerPredicate, assertCustomerProjectBusinessWrite, lockCustomerProjectBusinessWrite, assertServiceWriteAccess } = ports;
  const { responseLogicEntries } = ports.tables;
function questionMaintenanceOperationId(
  userId: number,
  clientRequestId: string,
  scope = "operation",
) {
  const hash = createHash("sha256")
    .update(`question-maintenance:${userId}:${getEnterpriseProjectScope()?.isLegacyDefault === false ? getEnterpriseProjectScope()!.enterpriseProjectId + ":" : ""}${clientRequestId}:${scope}`)
    .digest("hex");
  // Existing audit keys are the persisted replay boundary and must stay stable.
  // Question IDs cross UUID-validated APIs; SHA-256-derived custom UUIDs use v8.
  if (scope === "replacement") {
    const variant = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function applyQuestionMaintenance(input: {
  actor: Actor;
  value: ApplyQuestionMaintenanceInput;
}): Promise<QuestionMaintenanceResult> {
  if (input.actor.role !== "user" && !getEnterpriseProjectScope())
    throw new AuthServiceError(
      "INVALID_CREDENTIAL",
      "只有客户可以修改自己的问题",
    );
  const value = applyQuestionMaintenanceSchema.parse(input.value);
  const db = await getDb();
  if (!db)
    throw new AuthServiceError(
      "DATABASE_UNAVAILABLE",
      "Database is not configured",
    );
  const userId = enterpriseWorkspaceUserId(input.actor.id);
  await assertCustomerProjectBusinessWrite(input.actor, userId);
  const operationId = questionMaintenanceOperationId(
    userId,
    value.clientRequestId,
  );
  const requestHash = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return db.transaction(async (tx) => {
    await lockCustomerProjectBusinessWrite(tx, userId, input.actor);
    await ports.lockOwner(tx, userId);
    const prior = await ports.readAudit(tx, userId, operationId);
    if (prior) {
      if (prior.metadata.requestHash !== requestHash)
        throw new AuthServiceError("CONFLICT", "该请求编号已用于其他操作");
      return prior.metadata.result as QuestionMaintenanceResult;
    }
    const portal = await assertServiceWriteAccess(userId);
    const currentScope = portal.purchasedQuestions.find(
      (q) => q.id === value.questionId,
    );
    if (!currentScope)
      throw new AuthServiceError(
        "CONFLICT",
        "只能修改当前企业项目已选择的问题",
      );
    const question = (
      await tx
        .select()
        .from(workspaceQuestionTable())
        .where(
          and(
            eq(workspaceQuestionTable().id, value.questionId),
            workspaceQuestionOwnerPredicate(userId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (
      !question ||
      question.userId !== userId ||
      question.status !== "selected" ||
      question.selectionApprovalStatus !== "approved" ||
      question.revision !== value.expectedRevision ||
      question.contractId !== currentScope.contractId ||
      (question.quotaPeriodId ?? "") !== currentScope.quotaPeriodId
    ) {
      throw new AuthServiceError(
        "CONFLICT",
        "问题已更新或不属于当前企业项目，请刷新后重试",
      );
    }
    const now = new Date();
    let replacementQuestionId: string | null = null;
    if (value.action === "response_logic_reset") {
      const logic = (
        await tx
          .select({ revision: responseLogicEntries.revision })
          .from(responseLogicEntries)
          .where(
            and(
              enterpriseOwnerPredicate(responseLogicEntries, userId),
              eq(responseLogicEntries.questionId, question.id),
            ),
          )
          .limit(1)
          .for("update")
      )[0];
      if (!logic || logic.revision !== value.expectedResponseLogicRevision)
        throw new AuthServiceError("CONFLICT", "应答逻辑已更新，请刷新后重试");
      const deleted = await tx
        .delete(responseLogicEntries)
        .where(
          and(
            enterpriseOwnerPredicate(responseLogicEntries, userId),
            eq(responseLogicEntries.questionId, question.id),
            eq(
              responseLogicEntries.revision,
              value.expectedResponseLogicRevision,
            ),
          ),
        );
      if (!deleted[0].affectedRows)
        throw new AuthServiceError("CONFLICT", "应答逻辑已更新，请刷新后重试");
    } else {
      if (
        value.action === "modify" &&
        value.proposedQuestion.normalize("NFKC").trim() ===
          question.question.normalize("NFKC").trim()
      ) {
        throw new AuthServiceError("CONFLICT", "问题内容没有变化");
      }
      await tx
        .update(workspaceQuestionTable())
        .set({
          status: "archived",
          locked: false,
          archivedAt: now,
          revision: sql`${workspaceQuestionTable().revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaceQuestionTable().id, question.id),
            workspaceQuestionOwnerPredicate(userId),
            eq(workspaceQuestionTable().revision, value.expectedRevision),
          ),
        );
      if (value.action === "modify") {
        replacementQuestionId = questionMaintenanceOperationId(
          userId,
          value.clientRequestId,
          "replacement",
        );
        await tx.insert(workspaceQuestionTable()).values({
          id: replacementQuestionId,
          userId,
          contractId: question.contractId,
          quotaPeriodId: question.quotaPeriodId,
          externalQuestionId: null,
          sourceQuestionId: question.sourceQuestionId ?? question.id,
          candidateKey: null,
          category: question.category,
          question: value.proposedQuestion,
          intent: null,
          intentRevision: 1,
          intentConfirmedRevision: null,
          intentConfirmedAt: null,
          intentConfirmedByUserId: null,
          rationale: null,
          evidence: [],
          risks: [],
          source: "user",
          status: "selected",
          selectionApprovalStatus: "approved",
          selectionRequestedAt: now,
          selectionRequestedByUserId: input.actor.id,
          selectionApprovedAt: now,
          selectionApprovedByUserId: input.actor.id,
          locked: true,
          sourceTaskId: null,
          knowledgeSnapshotId: question.knowledgeSnapshotId,
          ordinal: question.ordinal,
          revision: 1,
          selectedAt: now,
          archivedAt: null,
          createdByUserId: input.actor.id,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    const result: QuestionMaintenanceResult = {
      action: value.action,
      questionId: question.id,
      replacementQuestionId,
    };
    await ports.writeAudit(tx, {
      operationId, userId, actor: input.actor, action: value.action,
      questionId: question.id, reason: value.reason, requestHash, result, now,
    });
    return result;
  });
}

return { questionMaintenanceOperationId, applyQuestionMaintenance };
}
