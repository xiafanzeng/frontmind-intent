import { sql } from "drizzle-orm";
import { boolean, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar, type AnyMySqlColumn } from "drizzle-orm/mysql-core";
import type { ConfirmedResponseLogic, ResponseLogicAppliedModelResult, ResponseLogicDraft, ResponseLogicPublicationMutation } from "../contracts/response-logic.js";
export type WorkspaceQuestionEvidenceRecord = { documentPath: string; excerpt: string; relevance: string };
export interface IntentSchemaCore {
  users: { id: AnyMySqlColumn };
  serviceContracts: { id: AnyMySqlColumn };
  serviceQuotaPeriods: { id: AnyMySqlColumn };
  knowledgeBaseSnapshots: { id: AnyMySqlColumn };
  currentEnterpriseProjectId(): string | null;
}
/** Core owns referenced identities; the module owns these unchanged business tables. */
export function createIntentSchema(core: IntentSchemaCore) {
const workspaceQuestions = mysqlTable(
  "workspace_questions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    contractId: varchar("contractId", { length: 36 })
      .notNull()
      .references(() => core.serviceContracts.id, { onDelete: "cascade" }),
    quotaPeriodId: varchar("quotaPeriodId", { length: 36 })
      .notNull()
      .references(() => core.serviceQuotaPeriods.id, { onDelete: "cascade" }),
    externalQuestionId: varchar("externalQuestionId", { length: 191 }),
    sourceQuestionId: varchar("sourceQuestionId", { length: 36 }),
    candidateKey: varchar("candidateKey", { length: 191 }),
    category: mysqlEnum("category", [
      "industry",
      "competitor_comparison",
      "reputation",
      "product_scenario",
    ]).notNull(),
    question: text("question").notNull(),
    intent: text("intent"),
    intentRevision: int("intentRevision", { unsigned: true })
      .default(1)
      .notNull(),
    intentConfirmedRevision: int("intentConfirmedRevision", {
      unsigned: true,
    }),
    intentConfirmedAt: timestamp("intentConfirmedAt"),
    intentConfirmedByUserId: int("intentConfirmedByUserId").references(
      () => core.users.id,
      { onDelete: "set null" },
    ),
    rationale: text("rationale"),
    evidence: json("evidence")
      .$type<WorkspaceQuestionEvidenceRecord[]>()
      .default([])
      .notNull(),
    risks: json("risks").$type<string[]>().default([]).notNull(),
    source: mysqlEnum("source", [
      "model",
      "website",
      "offline",
      "admin",
      "user",
    ])
      .default("model")
      .notNull(),
    status: mysqlEnum("status", ["candidate", "selected", "archived"])
      .default("candidate")
      .notNull(),
    selectionApprovalStatus: mysqlEnum("selectionApprovalStatus", [
      "not_requested",
      "pending",
      "approved",
    ])
      .default("not_requested")
      .notNull(),
    selectionRequestedAt: timestamp("selectionRequestedAt"),
    selectionRequestedByUserId: int("selectionRequestedByUserId").references(
      () => core.users.id,
      { onDelete: "set null" },
    ),
    selectionApprovedAt: timestamp("selectionApprovedAt"),
    selectionApprovedByUserId: int("selectionApprovedByUserId").references(
      () => core.users.id,
      { onDelete: "set null" },
    ),
    locked: boolean("locked").default(false).notNull(),
    sourceTaskId: varchar("sourceTaskId", { length: 255 }),
    knowledgeSnapshotId: varchar("knowledgeSnapshotId", {
      length: 36,
    }).references(() => core.knowledgeBaseSnapshots.id, { onDelete: "set null" }),
    ordinal: int("ordinal", { unsigned: true }).default(0).notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    selectedAt: timestamp("selectedAt"),
    archivedAt: timestamp("archivedAt"),
    createdByUserId: int("createdByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("workspace_questions_generation_key_uq").on(
      table.quotaPeriodId,
      table.sourceTaskId,
      table.candidateKey,
    ),
    index("workspace_questions_user_period_status_idx").on(
      table.userId,
      table.quotaPeriodId,
      table.status,
    ),
    index("workspace_questions_user_category_status_idx").on(
      table.userId,
      table.category,
      table.status,
    ),
    index("workspace_questions_user_approval_status_idx").on(
      table.userId,
      table.selectionApprovalStatus,
      table.updatedAt,
    ),
    index("workspace_questions_external_idx").on(
      table.userId,
      table.externalQuestionId,
    ),
    index("workspace_questions_source_question_idx").on(
      table.userId,
      table.sourceQuestionId,
    ),
  ],
);

const responseLogicEntries = mysqlTable(
  "response_logic_entries",
  {

    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).$defaultFn(() => core.currentEnterpriseProjectId() ?? sql`NULL`),    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    questionId: varchar("questionId", { length: 191 }).notNull(),
    groupId: varchar("groupId", { length: 128 }).notNull(),
    groupTitle: varchar("groupTitle", { length: 255 }).notNull(),
    question: text("question").notNull(),
    intent: text("intent").notNull(),
    summary: text("summary").notNull(),
    conversationId: varchar("conversationId", { length: 191 }),
    lastTaskId: varchar("lastTaskId", { length: 255 }),
    skillName: varchar("skillName", { length: 128 })
      .default("response-logic-builder")
      .notNull(),
    skillVersion: varchar("skillVersion", { length: 64 })
      .default("1")
      .notNull(),
    skillContentHash: varchar("skillContentHash", { length: 64 }),
    draft: json("draft").$type<ResponseLogicDraft>().notNull(),
    confirmed: json("confirmed").$type<ConfirmedResponseLogic>(),
    appliedModelResult: json("appliedModelResult").$type<ResponseLogicAppliedModelResult>(),
    lastPublicationMutation: json("lastPublicationMutation").$type<ResponseLogicPublicationMutation>(),
    version: int("version").default(0).notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    status: mysqlEnum("status", ["draft", "confirmed"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("response_logic_entries_user_question_uq").on(
      table.userId,
      table.questionId,
    ),
    index("response_logic_entries_user_status_idx").on(
      table.userId,
      table.status,
    ),
    uniqueIndex("response_logic_entries_user_conversation_uq").on(
      table.userId,
      table.conversationId,
    ),
  ],
);

const enterpriseProjectQuestions = mysqlTable(
  "enterprise_project_questions",
  {
    enterpriseProjectId: varchar("enterpriseProjectId", { length: 36 }).notNull().$defaultFn(() => { const id = core.currentEnterpriseProjectId(); if (!id) throw new Error("ENTERPRISE_PROJECT_REQUIRED"); return id; }),
    clientRequestId: varchar("clientRequestId", { length: 128 }),
    requestHash: varchar("requestHash", { length: 64 }),
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    contractId: varchar("contractId", { length: 36 })
      .references(() => core.serviceContracts.id, { onDelete: "cascade" }),
    quotaPeriodId: varchar("quotaPeriodId", { length: 36 })
      .references(() => core.serviceQuotaPeriods.id, { onDelete: "cascade" }),
    externalQuestionId: varchar("externalQuestionId", { length: 191 }),
    sourceQuestionId: varchar("sourceQuestionId", { length: 36 }),
    candidateKey: varchar("candidateKey", { length: 191 }),
    category: mysqlEnum("category", [
      "industry",
      "competitor_comparison",
      "reputation",
      "product_scenario",
    ]).notNull(),
    question: text("question").notNull(),
    intent: text("intent"),
    intentRevision: int("intentRevision", { unsigned: true })
      .default(1)
      .notNull(),
    intentConfirmedRevision: int("intentConfirmedRevision", {
      unsigned: true,
    }),
    intentConfirmedAt: timestamp("intentConfirmedAt"),
    intentConfirmedByUserId: int("intentConfirmedByUserId").references(
      () => core.users.id,
      { onDelete: "set null" },
    ),
    rationale: text("rationale"),
    evidence: json("evidence")
      .$type<WorkspaceQuestionEvidenceRecord[]>()
      .default([])
      .notNull(),
    risks: json("risks").$type<string[]>().default([]).notNull(),
    source: mysqlEnum("source", [
      "model",
      "website",
      "offline",
      "admin",
      "user",
    ])
      .default("model")
      .notNull(),
    status: mysqlEnum("status", ["candidate", "selected", "archived"])
      .default("candidate")
      .notNull(),
    selectionApprovalStatus: mysqlEnum("selectionApprovalStatus", [
      "not_requested",
      "pending",
      "approved",
    ])
      .default("not_requested")
      .notNull(),
    selectionRequestedAt: timestamp("selectionRequestedAt"),
    selectionRequestedByUserId: int("selectionRequestedByUserId").references(
      () => core.users.id,
      { onDelete: "set null" },
    ),
    selectionApprovedAt: timestamp("selectionApprovedAt"),
    selectionApprovedByUserId: int("selectionApprovedByUserId").references(
      () => core.users.id,
      { onDelete: "set null" },
    ),
    locked: boolean("locked").default(false).notNull(),
    sourceTaskId: varchar("sourceTaskId", { length: 255 }),
    knowledgeSnapshotId: varchar("knowledgeSnapshotId", {
      length: 36,
    }).references(() => core.knowledgeBaseSnapshots.id, { onDelete: "set null" }),
    ordinal: int("ordinal", { unsigned: true }).default(0).notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    selectedAt: timestamp("selectedAt"),
    archivedAt: timestamp("archivedAt"),
    createdByUserId: int("createdByUserId").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("enterprise_questions_request_uq").on(table.enterpriseProjectId, table.clientRequestId),
    index("enterprise_questions_project_status_idx").on(table.enterpriseProjectId, table.status),
    uniqueIndex("enterprise_questions_generation_key_uq").on(
      table.quotaPeriodId,
      table.sourceTaskId,
      table.candidateKey,
    ),
    index("enterprise_questions_user_period_status_idx").on(
      table.userId,
      table.quotaPeriodId,
      table.status,
    ),
    index("enterprise_questions_user_category_status_idx").on(
      table.userId,
      table.category,
      table.status,
    ),
    index("enterprise_questions_user_approval_status_idx").on(
      table.userId,
      table.selectionApprovalStatus,
      table.updatedAt,
    ),
    index("enterprise_questions_external_idx").on(
      table.userId,
      table.externalQuestionId,
    ),
    index("enterprise_questions_source_question_idx").on(
      table.userId,
      table.sourceQuestionId,
    ),
  ],
);
return { workspaceQuestions, responseLogicEntries, enterpriseProjectQuestions };
}
export type IntentSchema = ReturnType<typeof createIntentSchema>;
