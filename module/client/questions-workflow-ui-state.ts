import type { KeywordCategoryKey } from "../contracts/keyword-categories.js";
import type { PublicServicePortalQuestion } from "../contracts/questions.js";

export type QuestionsWorkflowFlow = {
  entry:
    | "start"
    | "direct"
    | "library"
    | "existing"
    | "result"
    | "edit"
    | "delete";
  instanceId: string;
  question: string;
  category: KeywordCategoryKey | null;
  library: {
    dashboardRevision: number;
    tableId: string;
    rowIndex: number;
    question: string;
    category: KeywordCategoryKey;
  } | null;
  confirming: boolean;
  selectedId: string | null;
  expectedRevision: number | null;
  filters: { query: string; category: string; page: number };
};

export type QuestionsWorkflowReceipts = {
  items: PublicServicePortalQuestion[];
  removedIds: string[];
};

/**
 * Project-scoped in-memory UI state for the optimized-question resource page.
 * Survives in-app navigation, resets on refresh, and is keyed per project so
 * a switch never leaks selections or receipts across the boundary.
 */
export const questionsWorkflowFlowCache = new Map<
  string,
  QuestionsWorkflowFlow
>();
export const questionsWorkflowReceiptCache = new Map<
  string,
  QuestionsWorkflowReceipts
>();

/** Test-only: drop the in-memory project state between isolated renders. */
export function clearQuestionsWorkflowProjectStateForTests() {
  questionsWorkflowFlowCache.clear();
  questionsWorkflowReceiptCache.clear();
}
