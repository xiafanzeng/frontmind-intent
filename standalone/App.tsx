import { useEffect, useMemo, useState } from "react";
import { ModuleShell } from "@frontmind/module-ui/dashboard/ModuleShell";
import "@frontmind/module-ui/dashboard/workflow.css";
import ModuleWorkspace, { type ModuleContext } from "../module/client/ModuleWorkspace";
import { INTENT_MODULE_LABEL } from "../module/client/module-label";
import { createStandaloneIntentAdapter } from "./standalone-adapter";

const moduleDefinition = { id: "intent", label: INTENT_MODULE_LABEL, color: "#7545a0" };
const views = [{ id: "questions", label: "优化问题" }, { id: "response-logic", label: "应答逻辑" }];
// 侧边栏按产品六大模块完整展示；本站只实现意图优化，其余模块仅作导航占位。
// 占位模块只在本地预览（演示完整产品口径）时显示，正式站点不展示未实现功能。
const previewNavigationModules = [
  { id: "brand", label: "品牌建设", color: "#16794f", views: [] },
  { ...moduleDefinition, views },
  { id: "progress", label: "进度监控", color: "#b45309", views: [] },
  { id: "content", label: "内容制作", color: "#0e7490", views: [] },
  { id: "publish", label: "媒体发布", color: "#be123c", views: [] },
  { id: "extensions", label: "AI专用官网", color: "#5e6174", views: [] },
];
const liveNavigationModules = [{ ...moduleDefinition, views }];

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
  if (!context || error) return <ModuleShell module={moduleDefinition} navigationModules={preview ? previewNavigationModules : liveNavigationModules} views={views} activeView="questions" onSelectView={() => {}}>
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
    renderFrame={({ activeView, onSelectView, children }) => <ModuleShell module={moduleDefinition} navigationModules={preview ? previewNavigationModules : liveNavigationModules} views={views} activeView={activeView === "response" ? "response-logic" : activeView} onSelectView={id => onSelectView(id === "response-logic" ? "response" : "questions")}>
      <div className="page-shell">{children}</div>
    </ModuleShell>}
  />;
}
