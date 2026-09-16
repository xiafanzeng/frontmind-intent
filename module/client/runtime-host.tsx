import { createElement } from "react";
import type { IntentWorkspaceHost } from "./host.js";

let current: IntentWorkspaceHost | undefined;
/** Each application installs its trusted host once, before rendering module UI. */
export function configureIntentWorkspaceHost(host: IntentWorkspaceHost) { current = host; }
function host() { if (!current) throw new Error("INTENT_WORKSPACE_HOST_REQUIRED"); return current; }
export const captureWorkspaceRestOperation: IntentWorkspaceHost["captureRestOperation"] = (...args) => host().captureRestOperation(...args);
export const useSearch = () => host().useSearch();
export const activeEnterpriseProjectId = () => host().activeEnterpriseProjectId();
export const createResponseLogicTask: IntentWorkspaceHost["createResponseLogicTask"] = (...args) => host().createResponseLogicTask(...args);
export const uploadChatLocalAsset: IntentWorkspaceHost["uploadChatLocalAsset"] = (...args) => host().uploadChatLocalAsset(...args);
export const toast = { success: (message: string) => host().toast.success(message), error: (message: string) => host().toast.error(message) };
export const trpc = new Proxy({} as IntentWorkspaceHost["trpc"], { get: (_, key) => Reflect.get(host().trpc, key) });
export const BusinessExecutionActivity: IntentWorkspaceHost["BusinessExecutionActivity"] = props => createElement(host().BusinessExecutionActivity, props);
export const FilePreview: IntentWorkspaceHost["FilePreview"] = props => createElement(host().FilePreview, props);
export const ImagePreview: IntentWorkspaceHost["ImagePreview"] = props => createElement(host().ImagePreview, props);
export const Button: IntentWorkspaceHost["Button"] = props => createElement(host().Button, props);

export const loadPreviewAdapter = () => host().loadPreviewAdapter?.() ?? Promise.reject(new Error("LOCAL_PREVIEW_ADAPTER_UNAVAILABLE"));
