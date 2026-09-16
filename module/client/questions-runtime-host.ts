import type { QuestionsHost } from "./questions-host.js";
let current: QuestionsHost | undefined;
export function configureQuestionsHost(host: QuestionsHost) { current = host; }
function host() { if (!current) throw new Error("INTENT_QUESTIONS_HOST_REQUIRED"); return current; }
export const useBusinessWorkspace: QuestionsHost["useBusinessWorkspace"] = () => host().useBusinessWorkspace();
export const useBusinessWorkspaceSummary: QuestionsHost["useBusinessWorkspaceSummary"] = input => host().useBusinessWorkspaceSummary(input);
export const trpc = new Proxy({} as QuestionsHost["trpc"], { get: (_, key) => Reflect.get(host().trpc, key) });
