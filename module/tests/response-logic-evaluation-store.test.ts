import { describe, expect, it } from "vitest";
import { isMissingTableError, createResponseLogicEvaluationStore } from "../server/response-logic-evaluation-store";

/** Mirrors Drizzle ORM 0.45.x errors.js DrizzleQueryError. */
class DrizzleQueryError extends Error {
  query: string;
  params: unknown[];
  cause: unknown;
  constructor(query: string, params: unknown[], cause: unknown) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.name = "DrizzleQueryError";
    this.query = query;
    this.params = params;
    this.cause = cause;
  }
}

/** Mirrors mysql2 ER_NO_SUCH_TABLE error. */
function mysqlNoSuchTable(): Error {
  const e = new Error("Table 'test.response_logic_evaluations' doesn't exist");
  (e as unknown as Record<string, unknown>).code = "ER_NO_SUCH_TABLE";
  (e as unknown as Record<string, unknown>).errno = 1146;
  return e;
}

function mysqlAccessDenied(): Error {
  const e = new Error("Access denied for user");
  (e as unknown as Record<string, unknown>).code = "ER_ACCESS_DENIED_ERROR";
  (e as unknown as Record<string, unknown>).errno = 1142;
  return e;
}

function mysqlConnectionLost(): Error {
  const e = new Error("Connection lost");
  (e as unknown as Record<string, unknown>).code = "ECONNRESET";
  (e as unknown as Record<string, unknown>).errno = -1;
  return e;
}

describe("isMissingTableError", () => {
  it("identifies a top-level MySQL ER_NO_SUCH_TABLE error", () => {
    expect(isMissingTableError(mysqlNoSuchTable())).toBe(true);
  });

  it("identifies a top-level error with only errno 1146 (no code property)", () => {
    const e = new Error("some driver error");
    (e as unknown as Record<string, unknown>).errno = 1146;
    expect(isMissingTableError(e)).toBe(true);
  });

  it("identifies a DrizzleQueryError wrapping a MySQL missing-table error via .cause", () => {
    const wrapped = new DrizzleQueryError(
      "select `id` from `response_logic_evaluations`",
      [1, "q1"],
      mysqlNoSuchTable(),
    );
    expect(isMissingTableError(wrapped)).toBe(true);
  });

  it("identifies a deeply nested cause chain ending in ER_NO_SUCH_TABLE", () => {
    const inner = mysqlNoSuchTable();
    const mid = new Error("ORM wrapper");
    (mid as unknown as Record<string, unknown>).cause = inner;
    const outer = new DrizzleQueryError("select 1", [], mid);
    expect(isMissingTableError(outer)).toBe(true);
  });

  it("does not misclassify access-denied as missing-table", () => {
    expect(isMissingTableError(mysqlAccessDenied())).toBe(false);
  });

  it("does not misclassify connection-lost as missing-table", () => {
    expect(isMissingTableError(mysqlConnectionLost())).toBe(false);
  });

  it("does not misclassify a DrizzleQueryError wrapping a non-missing-table error", () => {
    const wrapped = new DrizzleQueryError("select 1", [], mysqlAccessDenied());
    expect(isMissingTableError(wrapped)).toBe(false);
  });

  it("does not misclassify a generic Error without database properties", () => {
    expect(isMissingTableError(new Error("something random"))).toBe(false);
  });

  it("does not misclassify null or undefined", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError(42)).toBe(false);
  });

  it("handles a circular cause chain without infinite looping", () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = {};
    a.cause = b;
    b.cause = a;
    expect(isMissingTableError(a)).toBe(false);
  });

  it("does not misclassify a timeout error wrapped in DrizzleQueryError", () => {
    const timeout = new Error("Query timeout");
    (timeout as unknown as Record<string, unknown>).code = "ETIMEDOUT";
    const wrapped = new DrizzleQueryError("select 1", [], timeout);
    expect(isMissingTableError(wrapped)).toBe(false);
  });
});

describe("createResponseLogicEvaluationStore with Drizzle-wrapped errors", () => {
  /** Fake database that always throws the given error on any query. */
  function throwingDb(error: Error) {
    const call = async () => { throw error; };
    return {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: call }) }) }) }),
      insert: () => ({ values: call }),
    };
  }

  it("degrades to available:false when DrizzleQueryError wraps ER_NO_SUCH_TABLE (getLatest)", async () => {
    const drizzleError = new DrizzleQueryError(
      "select `id` from `response_logic_evaluations` where ...",
      [1, "q1"],
      mysqlNoSuchTable(),
    );
    const store = createResponseLogicEvaluationStore({
      getDb: async () => throwingDb(drizzleError) as never,
    });
    const result = await store.getLatest(1, "q1");
    expect(result.available).toBe(false);
  });

  it("degrades to available:false when DrizzleQueryError wraps ER_NO_SUCH_TABLE (save)", async () => {
    const drizzleError = new DrizzleQueryError(
      "insert into `response_logic_evaluations` ...",
      [],
      mysqlNoSuchTable(),
    );
    const store = createResponseLogicEvaluationStore({
      getDb: async () => throwingDb(drizzleError) as never,
    });
    const result = await store.save({
      userId: 1, questionId: "q1", recordRevision: 1, confirmedVersion: null,
      ruleVersion: "1",
      evaluation: { kind: "rule-evaluation", questionId: "q1", question: "", intent: "", version: null, revision: 1, logic: { concern: "", conclusion: "", facts: "", boundaries: "" }, sourceFingerprint: "", dimensions: { relevance: { score: 0, band: "", reason: "", evidence: "", issues: [], suggestions: [], effect: "", method: "" }, completeness: { score: 0, reason: "", coverage: [] }, actionability: { score: 0, reason: "", subMetrics: [] }, boundaryRisk: { score: null, note: "", risks: [], method: "" } } },
    });
    expect(result.available).toBe(false);
  });

  it("rethrows a DrizzleQueryError wrapping a non-missing-table error", async () => {
    const drizzleError = new DrizzleQueryError(
      "select `id` from `response_logic_evaluations` where ...",
      [1, "q1"],
      mysqlAccessDenied(),
    );
    const store = createResponseLogicEvaluationStore({
      getDb: async () => throwingDb(drizzleError) as never,
    });
    await expect(store.getLatest(1, "q1")).rejects.toThrow();
  });
});
