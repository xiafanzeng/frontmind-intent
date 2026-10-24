import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { index, int, json, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { IntentDatabase } from "./response-logic-service.js";
import type { ResponseLogicRuleEvaluation } from "../contracts/response-logic-evaluation.js";

/**
 * Runtime query view of the module-owned rule-evaluation table. Column shapes
 * mirror module/schema/index.ts, which carries the FK metadata consumed by the
 * Core drizzle migration flow. This standalone definition deliberately has no
 * foreign-key callbacks so the server can query the table through the existing
 * getDb() port without new host-injected ports.
 */
const responseLogicEvaluations = mysqlTable(
  "response_logic_evaluations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    questionId: varchar("questionId", { length: 191 }).notNull(),
    recordRevision: int("recordRevision").notNull(),
    confirmedVersion: int("confirmedVersion"),
    sourceFingerprint: varchar("sourceFingerprint", { length: 64 }).notNull(),
    ruleVersion: varchar("ruleVersion", { length: 32 }).notNull(),
    evaluation: json("evaluation").$type<ResponseLogicRuleEvaluation>().notNull(),
    status: mysqlEnum("status", ["completed", "failed"]).notNull(),
    createdAt: timestamp("createdAt").notNull(),
  },
  (table) => [
    index("response_logic_evaluations_user_question_idx").on(
      table.userId,
      table.questionId,
      table.createdAt,
    ),
  ],
);

export type StoredResponseLogicRuleEvaluation = {
  id: string;
  questionId: string;
  recordRevision: number;
  confirmedVersion: number | null;
  sourceFingerprint: string;
  ruleVersion: string;
  evaluation: ResponseLogicRuleEvaluation;
  createdAt: Date;
};

export type SaveRuleEvaluationInput = {
  userId: number;
  questionId: string;
  recordRevision: number;
  confirmedVersion: number | null;
  ruleVersion: string;
  evaluation: ResponseLogicRuleEvaluation;
};

export type RuleEvaluationStoreResult<T> =
  | { available: true; value: T }
  | { available: false };

export interface ResponseLogicEvaluationStore {
  save(input: SaveRuleEvaluationInput): Promise<RuleEvaluationStoreResult<boolean>>;
  getLatest(userId: number, questionId: string): Promise<RuleEvaluationStoreResult<StoredResponseLogicRuleEvaluation | null>>;
}

function isMissingTableError(error: unknown) {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  return (
    candidate?.code === "ER_NO_SUCH_TABLE" ||
    candidate?.errno === 1146
  );
}

/**
 * Persistence for server-side rule evaluations. "available: false" means the
 * physical table is not deployed yet (the Core migration has not shipped) or
 * the database is unreachable; callers must surface that state honestly and
 * never report an evaluation as persisted. Any other database error is a real
 * failure and is rethrown.
 */
export function createResponseLogicEvaluationStore(ports: {
  getDb(): Promise<IntentDatabase | null>;
}): ResponseLogicEvaluationStore {
  return {
    async save(input) {
      const db = await ports.getDb();
      if (!db) return { available: false };
      try {
        await db.insert(responseLogicEvaluations).values({
          id: randomUUID(),
          userId: input.userId,
          questionId: input.questionId,
          recordRevision: input.recordRevision,
          confirmedVersion: input.confirmedVersion,
          sourceFingerprint: input.evaluation.sourceFingerprint,
          ruleVersion: input.ruleVersion,
          evaluation: input.evaluation,
          status: "completed",
          createdAt: new Date(),
        });
        return { available: true, value: true };
      } catch (error) {
        if (isMissingTableError(error)) return { available: false };
        throw error;
      }
    },
    async getLatest(userId, questionId) {
      const db = await ports.getDb();
      if (!db) return { available: false };
      try {
        const rows = await db
          .select()
          .from(responseLogicEvaluations)
          .where(
            and(
              eq(responseLogicEvaluations.userId, userId),
              eq(responseLogicEvaluations.questionId, questionId),
              eq(responseLogicEvaluations.status, "completed"),
            ),
          )
          .orderBy(desc(responseLogicEvaluations.createdAt))
          .limit(1);
        const row = rows[0];
        return {
          available: true,
          value: row
            ? {
                id: row.id,
                questionId: row.questionId,
                recordRevision: row.recordRevision,
                confirmedVersion: row.confirmedVersion,
                sourceFingerprint: row.sourceFingerprint,
                ruleVersion: row.ruleVersion,
                evaluation: row.evaluation,
                createdAt: row.createdAt,
              }
            : null,
        };
      } catch (error) {
        if (isMissingTableError(error)) return { available: false };
        throw error;
      }
    },
  };
}
