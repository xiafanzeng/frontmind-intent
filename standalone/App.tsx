import { useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@frontmind/module-ui/dashboard/ModuleShell";
import "@frontmind/module-ui/dashboard/workflow.css";
import ModuleWorkspace, { type ModuleContext } from "../module/client/ModuleWorkspace";
import { INTENT_MODULE_LABEL } from "../module/client/module-label";
import { createStandaloneIntentAdapter } from "./standalone-adapter";

const moduleDefinition = { id: "intent", label: INTENT_MODULE_LABEL, color: "#7545a0" };
const views = [{ id: "questions", label: "优化问题" }, { id: "response-logic", label: "应答逻辑" }];

export default function App({ preview = false }: { preview?: boolean }) {
  const [context, setContext] = useState<ModuleContext | null>(preview ? { module: "intent", workspace: { id: "local-preview", ownerUserId: 0 }, marketEdition: "cn", capabilities: ["intent"] } : null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    void fetch("/api/module/context", { credentials: "same-origin", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("开发门禁验证失败，请重新打开页面");
        return response.json();
      })
      .then(value => {
        if (value.module !== "intent" || !value.workspace?.id) throw new Error("模块运行上下文无效");
        setContext(value);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [preview]);
  if (!context || error) return <ModuleShell module={moduleDefinition} views={views} activeView="questions" onSelectView={() => {}}>
    <div className="page-shell">{error ? <><p role="alert">{error}</p><button className="operator-control-secondary" onClick={() => location.reload()}>重新加载</button></> : <p role="status">正在进入意图优化…</p>}</div>
  </ModuleShell>;
  return <IntentWorkspaceContent key={context.workspace.id} preview={preview} context={context} />;
}

function IntentWorkspaceContent({ preview, context }: { preview: boolean; context: ModuleContext }) {
  const [notice, setNotice] = useState("");
  const adapter = useMemo(() => createStandaloneIntentAdapter(preview, context.workspace.id, setNotice), [preview, context.workspace.id]);
  return <ModuleWorkspace
    preview={preview}
    context={context}
    adapter={adapter}
    notice={notice}
    onDismissNotice={() => setNotice("")}
    renderFrame={({ activeView, onSelectView, children }) => <ModuleShell module={moduleDefinition} views={views} activeView={activeView === "response" ? "response-logic" : activeView} onSelectView={id => onSelectView(id === "response-logic" ? "response" : "questions")}>
      <div className="page-shell">{children}</div>
    </ModuleShell>}
  />;
}
