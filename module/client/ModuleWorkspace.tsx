import { useEffect, useState, type ReactNode } from "react";
import { QuestionGenerationPanel } from "./QuestionGenerationPanel.js";
import { QuestionsWorkflow } from "./QuestionsWorkflow.js";
import ResponseLogicWorkspace from "./ResponseLogicWorkspace.js";
import { configureIntentWorkspaceHost } from "./runtime-host.js";
import { configureQuestionsHost } from "./questions-runtime-host.js";
import type { IntentWorkspaceHost } from "./host.js";
import type { QuestionsHost, IntentQuery } from "./questions-host.js";
import type { ServicePortalQuestion } from "../contracts/questions.js";
import { KEYWORD_CATEGORY_OPTIONS, keywordCategoryTone } from "../contracts/keyword-categories.js";
import "./standalone.css";

export type ModuleContext = { module: string; workspace: { id: string; ownerUserId: number }; marketEdition: string; capabilities: string[] };
export type IntentWorkspaceView = "questions" | "response";
export type IntentWorkspaceFrame = {
  activeView: IntentWorkspaceView;
  onSelectView: (view: IntentWorkspaceView) => void;
  children: ReactNode;
};

export default function ModuleWorkspace({
  preview = false,
  context,
  adapter,
  notice = "",
  onDismissNotice = () => {},
  renderFrame,
}: {
  preview?: boolean;
  context: ModuleContext;
  adapter: { responseHost: IntentWorkspaceHost; questionsHost: QuestionsHost; questions: { useQuery(): IntentQuery<{ questions: ServicePortalQuestion[] }> } };
  notice?: string;
  onDismissNotice?: () => void;
  renderFrame?: (frame: IntentWorkspaceFrame) => ReactNode;
}) {
  configureIntentWorkspaceHost(adapter.responseHost);
  configureQuestionsHost(adapter.questionsHost);
  const query = adapter.questions.useQuery();
  const [questionId, setQuestionId] = useState<string | null>(() => new URLSearchParams(location.search).get("questionId"));
  const [page, setPage] = useState<IntentWorkspaceView>(() => location.pathname === "/response-logic" ? "response" : "questions");
  const navigate = (next: IntentWorkspaceView, id?: string) => {
    setPage(next);
    setQuestionId(id ?? null);
    history.pushState(null, "", next === "response"
      ? `/response-logic${id ? `?questionId=${encodeURIComponent(id)}` : ""}`
      : "/brand-question-portfolio");
  };
  useEffect(() => {
    const restore = () => {
      setPage(location.pathname === "/response-logic" ? "response" : "questions");
      setQuestionId(new URLSearchParams(location.search).get("questionId"));
    };
    window.addEventListener("popstate", restore);
    if (!["/", "/brand-question-portfolio", "/response-logic"].includes(location.pathname)) {
      history.replaceState(null, "", "/brand-question-portfolio");
    }
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const groups = KEYWORD_CATEGORY_OPTIONS.map(category => ({
    id: ({ industry: "ranking", competitor_comparison: "comparison", reputation: "reputation", product_scenario: "basic" } as const)[category.key],
    title: category.label,
    subtitle: "已保存的优化问题",
    tone: keywordCategoryTone(category.key) ?? "plum" as const,
    questions: (query.data?.questions ?? [])
      .filter(question => question.status === "selected" && question.category === category.key)
      .map(question => ({ id: question.id, question: question.question, intent: question.intent ?? "", summary: question.rationale ?? "" })),
  }));
  const children = <div className="intent-workspace">
    {preview && <aside className="intent-preview-banner">本地预览 · 合成样例，仅在当前浏览器内交互，不连接真实业务或供应商。</aside>}
    {notice && <div role="status" className="intent-notice">{notice}<button type="button" aria-label="关闭提示" onClick={onDismissNotice}>×</button></div>}
    <div className="intent-workspace-content">
      {page === "questions" ? <>
        <QuestionGenerationPanel preview={preview} workspaceId={context.workspace.id} candidates={(query.data?.questions ?? []).filter(question => question.status === "candidate")} onUpdate={() => query.refetch()} />
        <QuestionsWorkflow portal={{ capabilities: { questionSelection: { allowed: true } } }} allowLibrary={false} onOpenResponseLogic={id => navigate("response", id)} />
      </> : <ResponseLogicWorkspace preview={preview} questionGroups={groups} initialQuestionId={questionId} onPublished={() => { void query.refetch(); }} />}
    </div>
  </div>;
  return renderFrame ? renderFrame({
    activeView: page,
    onSelectView: next => navigate(next, next === "response" ? questionId ?? undefined : undefined),
    children,
  }) : children;
}
