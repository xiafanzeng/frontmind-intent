import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { createRuntime, type IntentRuntimeCore } from "../server/router.js";
import { createIntentSchema } from "../schema/index.js";
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";

class ServiceError extends Error { constructor(readonly code: string, message: string) { super(message); } }
const users = mysqlTable("users", { id: int("id").primaryKey() });
const reference = mysqlTable("reference", { id: varchar("id", { length: 36 }).primaryKey() });
const tables = createIntentSchema({ users, serviceContracts: reference, serviceQuotaPeriods: reference, knowledgeBaseSnapshots: reference, currentEnterpriseProjectId: () => "project-1" });
const servers: http.Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }))); });
async function address(core: IntentRuntimeCore) {
  const server = http.createServer(createRuntime(core).handle);
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const result = server.address(); if (!result || typeof result === "string") throw new Error("Test server has no TCP address");
  return `http://127.0.0.1:${result.port}`;
}
function fixture(authenticated: boolean) {
  let reads = 0;
  const tablePorts = { tables, AuthServiceError: ServiceError, getDb: async () => { reads++; throw new Error("Database should not be reached in invalid requests"); } };
  const core = {
    intent: { questions: tablePorts, responseLogic: tablePorts, maintenance: tablePorts },
    withIntentIdentity: async (_request: unknown, run: (identity: { userId: number; actor: { id: number; username: string; role: string } }) => Promise<unknown>) => {
      if (!authenticated) throw new ServiceError("UNAUTHORIZED", "请先登录");
      return run({ userId: 7, actor: { id: 9, username: "operator", role: "user" } });
    },
    intentReadiness: async () => ({ ok: true }),
  } as unknown as IntentRuntimeCore;
  return { core, readCount: () => reads };
}

describe("intent API identity boundary", () => {
  it("rejects unauthenticated reads before accessing the database", async () => {
    const test = fixture(false); const url = await address(test.core);
    const response = await fetch(`${url}/api/intent/questions`);
    expect(response.status).toBe(401); expect(test.readCount()).toBe(0);
  });
  it("does not accept owner/actor coordinates from a submitted question", async () => {
    const test = fixture(true); const url = await address(test.core);
    const response = await fetch(`${url}/api/intent/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "What should we monitor?", category: "industry", userId: 123, actorUserId: 123 }) });
    expect(response.status).toBe(400); expect(test.readCount()).toBe(0);
  });
  it("requires the observed question revision when selecting an existing question", async () => {
    const test = fixture(true); const url = await address(test.core);
    const response = await fetch(`${url}/api/intent/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: "de305d54-75b4-431b-adb2-eb6b9e546014" }) });
    expect(response.status).toBe(400); expect(test.readCount()).toBe(0);
  });
});
