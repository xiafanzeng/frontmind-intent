import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { IntentSchema } from "../schema/index.js";
import type { IntentDatabase, IntentTransaction } from "./response-logic-service.js";
import type { ServicePortalQuestion, WorkspaceQuestionCategory } from "../contracts/questions.js";
export interface IntentQuestionPorts {
  tables: IntentSchema;
  getDb(): Promise<IntentDatabase | null>;
  AuthServiceError: new (code: "CONFLICT" | "NOT_FOUND" | "DATABASE_UNAVAILABLE", message: string) => Error & { readonly code: string };
  getEnterpriseProjectScope(): { actorUserId: number } | undefined;
  enterpriseProjectIdForOwner(userId: number): string | null;
  enterpriseProjectOperationId(ownerId: number, requestId: string): string;
  lockCustomerProjectBusinessWrite(tx: IntentTransaction, userId: number): Promise<unknown>;
  lockOwner(tx: IntentTransaction, userId: number): Promise<void>;
}
export function createIntentQuestionRepository(ports: IntentQuestionPorts) {
  const { getDb, AuthServiceError, getEnterpriseProjectScope, enterpriseProjectIdForOwner, enterpriseProjectOperationId, lockCustomerProjectBusinessWrite } = ports;
  const { enterpriseProjectQuestions: questions, workspaceQuestions } = ports.tables;
function workspaceQuestionTable() {
  // The persisted fields are compatible. Only the tool table permits absent
  // historical contract coordinates; callers project those explicitly.
  return (getEnterpriseProjectScope() ? questions : workspaceQuestions) as typeof workspaceQuestions;
}
function workspaceQuestionOwnerPredicate(userId: number) {
  const projectId = enterpriseProjectIdForOwner(userId);
  return projectId ? and(eq(questions.userId, userId), eq(questions.enterpriseProjectId, projectId))! : eq(workspaceQuestions.userId, userId);
}
async function context(userId: number) {
  const enterpriseProjectId = enterpriseProjectIdForOwner(userId);
  if (!enterpriseProjectId) throw new AuthServiceError("CONFLICT", "请先选择企业项目");
  const db = await getDb();
  if (!db) throw new AuthServiceError("DATABASE_UNAVAILABLE", "数据库暂不可用");
  return { db, enterpriseProjectId };
}
function projectQuestionDto(row: typeof questions.$inferSelect): ServicePortalQuestion {
  return {
    ...row,
    quotaPeriodId: row.quotaPeriodId ?? "",
    intentConfirmed: row.intentConfirmedRevision === row.intentRevision && row.intentConfirmedAt !== null,
    intentConfirmedAt: row.intentConfirmedAt?.getTime() ?? null,
    selectionRequestedAt: row.selectionRequestedAt?.getTime() ?? null,
    selectionApprovedAt: row.selectionApprovedAt?.getTime() ?? null,
  };
}
async function listEnterpriseQuestions(userId: number, includeArchived = false) {
  const { db, enterpriseProjectId } = await context(userId);
  const rows = await db.select().from(questions).where(and(eq(questions.userId, userId), eq(questions.enterpriseProjectId, enterpriseProjectId), includeArchived ? undefined : inArray(questions.status, ["candidate", "selected"]))).orderBy(asc(questions.ordinal), asc(questions.createdAt));
  return rows.map(projectQuestionDto);
}

async function selectEnterpriseQuestion(input: {
  userId: number; actorUserId: number; questionId?: string; expectedRevision?: number;
  question?: string; category?: WorkspaceQuestionCategory; clientRequestId?: string;
}) {
  const { db, enterpriseProjectId } = await context(input.userId);
  return db.transaction(async tx => {
    await lockCustomerProjectBusinessWrite(tx, input.userId);
    // Lock project question writes through the owner to cover the missing-row case.
    await ports.lockOwner(tx, input.userId);
    const now = new Date();
    if (input.questionId) {
      const [row] = await tx.select().from(questions).where(and(eq(questions.id, input.questionId), workspaceQuestionOwnerPredicate(input.userId))).limit(1).for("update");
      if (!row || row.status === "archived") throw new AuthServiceError("NOT_FOUND", "当前企业项目没有该问题");
      if (row.status === "selected") return projectQuestionDto(row);
      if (row.revision !== input.expectedRevision) throw new AuthServiceError("CONFLICT", "问题已变化，请刷新后重试");
      const changes = { status: "selected" as const, locked: true, selectionApprovalStatus: "approved" as const, selectedAt: now, selectionApprovedAt: now, selectionApprovedByUserId: input.actorUserId, revision: row.revision + 1 };
      await tx.update(questions).set(changes).where(and(eq(questions.id, row.id), workspaceQuestionOwnerPredicate(input.userId)));
      return projectQuestionDto({ ...row, ...changes });
    }
    const text = input.question?.trim();
    if (!text || !input.category) throw new AuthServiceError("CONFLICT", "请填写问题并选择类型");
    const requestHash = createHash("sha256").update(JSON.stringify({ text, category: input.category })).digest("hex");
    // Older clients have no request id. Exact project/text/category replay is
    // deterministic, while a new explicit request id can represent a new row.
    const clientRequestId = input.clientRequestId ?? `question:${requestHash}`;
    const [prior] = await tx.select().from(questions).where(and(eq(questions.enterpriseProjectId, enterpriseProjectId), eq(questions.clientRequestId, clientRequestId))).limit(1);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new AuthServiceError("CONFLICT", "该请求编号已用于另一问题");
      return projectQuestionDto(prior);
    }
    const id = enterpriseProjectOperationId(input.userId, `question:${enterpriseProjectId}:${clientRequestId}`);
    await tx.insert(questions).values({ id, enterpriseProjectId, userId: input.userId, clientRequestId, requestHash, question: text, category: input.category, source: "user", status: "selected", locked: true, selectionApprovalStatus: "approved", selectedAt: now, selectionApprovedAt: now, selectionApprovedByUserId: input.actorUserId, createdByUserId: input.actorUserId });
    const [created] = await tx.select().from(questions).where(eq(questions.id, id)).limit(1);
    return projectQuestionDto(created!);
  });
}

async function confirmEnterpriseQuestionIntent(input: { userId: number; questionId: string; expectedRevision: number; expectedIntentRevision: number }) {
  const { db } = await context(input.userId);
  return db.transaction(async tx => {
    await lockCustomerProjectBusinessWrite(tx, input.userId);
    const [row] = await tx.select().from(questions).where(and(eq(questions.id, input.questionId), workspaceQuestionOwnerPredicate(input.userId))).limit(1).for("update");
    if (!row || row.status !== "selected" || row.revision !== input.expectedRevision || row.intentRevision !== input.expectedIntentRevision) throw new AuthServiceError("CONFLICT", "问题已更新，请刷新后重试");
    if (!row.intent?.trim()) throw new AuthServiceError("CONFLICT", "请先补充问题意图");
    const changes = { intentConfirmedRevision: row.intentRevision, intentConfirmedAt: new Date(), intentConfirmedByUserId: getEnterpriseProjectScope()?.actorUserId ?? input.userId, revision: row.revision + 1 };
    await tx.update(questions).set(changes).where(and(eq(questions.id, row.id), workspaceQuestionOwnerPredicate(input.userId)));
    return projectQuestionDto({ ...row, ...changes });
  });
}


return { workspaceQuestionTable, workspaceQuestionOwnerPredicate, projectQuestionDto, listEnterpriseQuestions, selectEnterpriseQuestion, confirmEnterpriseQuestionIntent };
}
