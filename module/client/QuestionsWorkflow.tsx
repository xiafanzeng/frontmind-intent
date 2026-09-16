import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "./questions-runtime-host.js";
import { keywordCategoryLabel } from "../contracts/keyword-categories.js";
import { type PublicServicePortalQuestion } from "../contracts/questions.js";
import type { ServicePortalView } from "./questions-host.js";
import type { QuestionIntakeDraft } from "./question-intake.js";
import { questionCategoryOptions } from "./question-intake.js";
import {
  useBusinessWorkspace,
  useBusinessWorkspaceSummary,
} from "./questions-runtime-host.js";
import {
  questionsWorkflowFlowCache,
  questionsWorkflowReceiptCache,
} from "./questions-workflow-ui-state.js";
import { WorkflowFeedback, WorkflowPagination } from "./workflow.js";
import { QuestionAddDialog } from "./QuestionAddDialog.js";
import { Button } from "./runtime-host.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog.js";
import type { QuestionIntakeSubmitInput } from "./question-intake.js";
import type {
  QuestionsWorkflowFlow,
  QuestionsWorkflowReceipts,
} from "./questions-workflow-ui-state.js";

type Flow = QuestionsWorkflowFlow;
type ProjectReceipts = QuestionsWorkflowReceipts;

const initialFlow = (): Flow => ({
  entry: "start",
  instanceId: crypto.randomUUID(),
  question: "",
  category: null,
  library: null,
  confirming: false,
  selectedId: null,
  expectedRevision: null,
  filters: { query: "", category: "", page: 0 },
});

/**
 * The caches live in a dedicated module (see questions-workflow-ui-state.ts):
 * project-scoped in-memory UI state that survives in-app navigation, resets
 * on refresh, and never touches hidden task records.
 */
const flowCache = questionsWorkflowFlowCache;
const receiptCache = questionsWorkflowReceiptCache;

export function QuestionsWorkflow({
  portal,
  intakeDraft,
  onIntakeDraftChange,
  onPortalRefresh,
  onOpenResponseLogic,
  savedQuestion,
  allowLibrary = true,
}: {
  portal: ServicePortalView;
  allowLibrary?: boolean;
  savedQuestion?: PublicServicePortalQuestion | null;
  intakeDraft?: QuestionIntakeDraft | null;
  onIntakeDraftChange?: (draft: QuestionIntakeDraft | null) => void;
  onPortalRefresh?: () => unknown | Promise<unknown>;
  onOpenResponseLogic: (questionId: string) => void;
}) {
  const { task } = useBusinessWorkspace();
  const scopeKey = task?.scopeKey ?? "questions-resource";
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const utils = trpc.useUtils();
  const portfolio = trpc.workspace.questionPortfolio.useQuery(undefined, {
    retry: false,
  });
  const dashboard = trpc.workspace.dashboard.useQuery(undefined, {
    retry: false,
  });
  const create = trpc.workspace.requestQuestionSelection.useMutation();
  const maintain = trpc.workspace.questionMaintenance.execute.useMutation();
  const [flow, setFlow] = useState<Flow>(
    () => flowCache.get(scopeKey) ?? initialFlow(),
  );
  const [receipts, setReceipts] = useState<ProjectReceipts>(
    () => receiptCache.get(scopeKey) ?? { items: [], removedIds: [] },
  );
  useEffect(() => {
    flowCache.set(scopeKey, flow);
  }, [scopeKey, flow]);
  useEffect(() => {
    receiptCache.set(scopeKey, receipts);
  }, [scopeKey, receipts]);
  useEffect(() => {
    setFlow(flowCache.get(scopeKey) ?? initialFlow());
    setReceipts(receiptCache.get(scopeKey) ?? { items: [], removedIds: [] });
    setError("");
    setAddOpen(false);
    setBusy(false);
    setListReloadNeeded(false);
    inFlight.current = false;
  }, [scopeKey]);
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [listReloadNeeded, setListReloadNeeded] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!portfolio.isError) setListReloadNeeded(false);
  }, [portfolio.isError]);
  const questions = useMemo(() => {
    const items = new Map(
      receipts.items.map((question) => [question.id, question]),
    );
    for (const question of portfolio.data?.questions ?? []) {
      const confirmed = items.get(question.id);
      // A cached query can lag behind the mutation receipt. Keep that receipt
      // until the portfolio supplies a strictly newer domain revision.
      if (!confirmed || question.revision > confirmed.revision)
        items.set(question.id, question);
      else if (
        question.revision === confirmed.revision &&
        question.responseLogicConfirmed !== undefined
      ) {
        // Confirming an answer does not change the question revision. Refresh
        // its derived status while retaining the saved question receipt.
        items.set(question.id, {
          ...confirmed,
          responseLogicConfirmed: question.responseLogicConfirmed,
        });
      }
    }
    return [...items.values()].filter(
      (question) => !receipts.removedIds.includes(question.id),
    );
  }, [receipts, portfolio.data]);
  const active = questions.find((question) => question.id === flow.selectedId);
  const selectedQuestions = questions.filter(
    (question) => question.status === "selected",
  );
  const update = (patch: Partial<Flow>) =>
    setFlow((current) => ({ ...current, ...patch }));
  const openQuestion = (
    question: PublicServicePortalQuestion,
    mode: "result" | "edit" | "delete" = "result",
  ) => {
    if (busy) return;
    setError("");
    update({
      entry: mode,
      selectedId: question.id,
      question: question.question,
      category: question.category,
      expectedRevision: question.revision,
      confirming: false,
      instanceId: crypto.randomUUID(),
    });
  };
  // An intake handoff from an explicit user selection opens the dialog once;
  // the parent clears the draft when leaving the page or switching projects,
  // so refresh and re-entry always land on a closed modal.
  const adoptedDraft = useRef<string | null>(null);
  useEffect(() => {
    if (!intakeDraft?.libraryRef || !intakeDraft.category) return;
    const signature = JSON.stringify(intakeDraft);
    if (adoptedDraft.current === signature) return;
    adoptedDraft.current = signature;
    update({
      entry: "library",
      question: intakeDraft.question,
      category: intakeDraft.category,
      library: {
        ...intakeDraft.libraryRef,
        question: intakeDraft.question,
        category: intakeDraft.category,
      },
      confirming: true,
    });
    setAddOpen(true);
  }, [intakeDraft]);
  // A saved question (e.g. from the word library) locates the row in the list
  // using the domain receipt only — no second create and no confirmation.
  useEffect(() => {
    if (!savedQuestion) return;
    setReceipts((current) => ({
      items: [
        savedQuestion,
        ...current.items.filter((item) => item.id !== savedQuestion.id),
      ],
      removedIds: current.removedIds.filter((id) => id !== savedQuestion.id),
    }));
    update({
      entry: "result",
      selectedId: savedQuestion.id,
      expectedRevision: savedQuestion.revision,
      question: savedQuestion.question,
      category: savedQuestion.category,
      confirming: false,
      filters: { query: "", category: "", page: 0 },
    });
    setStatusFilter("");
  }, [savedQuestion]);
  useBusinessWorkspaceSummary({ title: "优化问题", items: [], outputs: [] });
  const refresh = async () => {
    await Promise.allSettled([
      utils.workspace.questionPortfolio.invalidate(),
      utils.workspace.portal.invalidate(),
      utils.workspace.responseLogic.invalidate(),
      Promise.resolve(onPortalRefresh?.()),
    ]);
  };
  const submit = async (input: QuestionIntakeSubmitInput) => {
    const submittedFlow: Flow = {
      ...flow,
      entry: input.origin === "brand_keyword_library" ? "library" : "direct",
      question: input.question,
      category: input.category,
      library:
        input.libraryRef && input.category
          ? {
              ...input.libraryRef,
              question: input.question,
              category: input.category,
            }
          : null,
    };
    if (
      inFlight.current ||
      !submittedFlow.category ||
      !submittedFlow.question.trim()
    )
      return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const requestScope = scopeKey;
    let result: PublicServicePortalQuestion | null = null;
    try {
      const response =
        submittedFlow.entry === "library" && submittedFlow.library
          ? await create.mutateAsync({
              mode: "brand_keyword_library",
              dashboardRevision: submittedFlow.library.dashboardRevision,
              tableId: submittedFlow.library.tableId,
              rowIndex: submittedFlow.library.rowIndex,
            })
          : await create.mutateAsync({
              mode: "direct",
              question: submittedFlow.question.trim(),
              category: submittedFlow.category,
            });
      result = response.question;
      // A late response from another project must not leak into this one.
      if (activeScope.current !== requestScope) return Boolean(result);
      setReceipts((current) => ({
        ...current,
        items: [
          result!,
          ...current.items.filter((item) => item.id !== result!.id),
        ],
        removedIds: current.removedIds.filter((id) => id !== result!.id),
      }));
      setFlow({
        ...submittedFlow,
        entry: "result",
        selectedId: result.id,
        expectedRevision: result.revision,
        confirming: false,
        question: result.question,
        filters: { query: "", category: "", page: 0 },
      });
      setStatusFilter("");
      onIntakeDraftChange?.(null);
      await refresh();
      if (activeScope.current === requestScope) setListReloadNeeded(true);
      return true;
    } catch (cause) {
      if (activeScope.current === requestScope)
        setError(
          result
            ? "问题已保存，请从项目已有问题继续；无需重复提交。"
            : cause instanceof Error
              ? cause.message
              : "保存失败，输入已保留。",
        );
      if (!result && submittedFlow.entry === "library")
        void dashboard.refetch();
      return Boolean(result);
    } finally {
      if (activeScope.current === requestScope) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const maintainIntent = useRef<{ fingerprint: string; id: string } | null>(
    null,
  );
  const saveEdit = async () => {
    if (inFlight.current || !active || flow.expectedRevision === null) return;
    const action = flow.entry === "delete" ? "delete" : "modify";
    const fingerprint = JSON.stringify([
      active.id,
      flow.expectedRevision,
      action,
      flow.question.trim(),
    ]);
    if (maintainIntent.current?.fingerprint !== fingerprint)
      maintainIntent.current = { fingerprint, id: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError("");
    const requestScope = scopeKey;
    try {
      const common = {
        questionId: active.id,
        expectedRevision: flow.expectedRevision,
        clientRequestId: maintainIntent.current.id,
      };
      const result = await maintain.mutateAsync(
        action === "delete"
          ? { ...common, action }
          : { ...common, action, proposedQuestion: flow.question.trim() },
      );
      if (activeScope.current !== requestScope) return;
      const nextId = result.replacementQuestionId ?? result.questionId;
      setReceipts((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== active.id),
        removedIds: [...current.removedIds, active.id],
      }));
      setFlow({
        ...flow,
        entry: action === "delete" ? "start" : "result",
        selectedId: action === "delete" ? null : nextId,
        confirming: false,
      });
      await refresh();
      if (activeScope.current === requestScope) setListReloadNeeded(true);
    } catch (cause) {
      if (activeScope.current === requestScope)
        setError(
          cause instanceof Error ? cause.message : "操作失败，输入已保留。",
        );
    } finally {
      if (activeScope.current === requestScope) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const existing = selectedQuestions.filter(
    (question) =>
      question.question
        .toLocaleLowerCase()
        .includes(flow.filters.query.toLocaleLowerCase()) &&
      (!flow.filters.category || question.category === flow.filters.category) &&
      (!statusFilter ||
        (statusFilter === "confirmed") ===
          Boolean(question.responseLogicConfirmed)),
  );
  const page = Math.min(
    flow.filters.page,
    Math.max(0, Math.ceil(existing.length / 10) - 1),
  );
  return (
    <div className="questions-resource">
      <div className="questions-resource__toolbar">
        <h2>优化问题</h2>
        <input
          type="search"
          aria-label="搜索已有问题"
          placeholder="搜索问题"
          value={flow.filters.query}
          onChange={(event) =>
            update({
              filters: { ...flow.filters, query: event.target.value, page: 0 },
            })
          }
        />
        <select
          aria-label="筛选问题类别"
          value={flow.filters.category}
          onChange={(event) =>
            update({
              filters: {
                ...flow.filters,
                category: event.target.value,
                page: 0,
              },
            })
          }
        >
          <option value="">全部类别</option>
          {questionCategoryOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="筛选应答状态"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            update({ filters: { ...flow.filters, page: 0 } });
          }}
        >
          <option value="">全部状态</option>
          <option value="pending">待制作应答</option>
          <option value="confirmed">已有正式应答</option>
        </select>
        <Button
          variant="operator"
          disabled={busy}
          onClick={() => {
            setError("");
            setAddOpen(true);
          }}
        >
          新增问题
        </Button>
      </div>
      {portfolio.isError && (
        <WorkflowFeedback error onRetry={() => void portfolio.refetch()}>
          问题读取失败
        </WorkflowFeedback>
      )}
      {listReloadNeeded && portfolio.isError && (
        <WorkflowFeedback error onRetry={() => void portfolio.refetch()}>
          问题已保存，但清单刷新失败；重试只重新加载清单，不会重复保存。
        </WorkflowFeedback>
      )}
      <div className="questions-resource__table-wrap">
        <table aria-label="优化问题清单">
          <thead>
            <tr>
              <th>问题</th>
              <th>分类</th>
              <th>应答状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {existing.slice(page * 10, (page + 1) * 10).map((question) => (
              <tr
                key={question.id}
                aria-selected={question.id === flow.selectedId}
              >
                <td>{question.question}</td>
                <td>
                  <span
                    className="fm-question-category-pill"
                    data-category={question.category}
                  >
                    {keywordCategoryLabel(question.category)}
                  </span>
                </td>
                <td>
                  {question.responseLogicConfirmed
                    ? "已有正式应答"
                    : "待制作应答"}
                </td>
                <td>
                  <div className="questions-resource__row-actions">
                    <Button
                      variant="operatorOutline"
                      onClick={() => onOpenResponseLogic(question.id)}
                    >
                      进入应答逻辑
                    </Button>
                    <Button
                      variant="operatorOutline"
                      disabled={busy}
                      onClick={() => openQuestion(question, "edit")}
                    >
                      修改问题
                    </Button>
                    <Button
                      variant="operatorOutline"
                      disabled={busy}
                      onClick={() => openQuestion(question, "delete")}
                    >
                      删除问题
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!existing.length && (
        <p className="questions-resource__empty">
          {portfolio.isLoading
            ? "正在读取问题…"
            : selectedQuestions.length
              ? "没有符合条件的问题。"
              : "还没有优化问题，点击新增问题开始。"}
        </p>
      )}
      <WorkflowPagination
        total={existing.length}
        page={page}
        onChange={(page) => update({ filters: { ...flow.filters, page } })}
      />
      <QuestionAddDialog
        allowLibrary={allowLibrary}
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) onIntakeDraftChange?.(null);
        }}
        initialDraft={intakeDraft}
        tables={dashboard.data?.payload?.keywordTables ?? []}
        revision={dashboard.data?.revision}
        libraryLoading={dashboard.isLoading}
        libraryError={dashboard.isError}
        onRetryLibrary={() => void dashboard.refetch()}
        allowed={portal.capabilities.questionSelection.allowed}
        unavailableReason={
          portal.capabilities.questionSelection.reason ?? undefined
        }
        submitting={busy}
        error={error}
        onSubmit={submit}
      />
      <Dialog
        open={
          (flow.entry === "edit" || flow.entry === "delete") && Boolean(active)
        }
        onOpenChange={(open) => {
          if (!open && !busy && active) openQuestion(active);
        }}
      >
        <DialogContent
          className="question-add-dialog question-add-dialog--selection"
          style={{ "--module-accent": "#7545a0" } as React.CSSProperties}
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {flow.entry === "delete" ? "删除优化问题？" : "修改问题"}
            </DialogTitle>
            <DialogDescription>
              历史监控继续保留原问题。
              {flow.entry === "edit"
                ? "修改后需重新检查受影响的应答。"
                : "删除后将从当前优化清单移除。"}
            </DialogDescription>
          </DialogHeader>
          {flow.entry === "edit" ? (
            <div className="question-add-dialog__fields">
              <label>
                目标问题
                <textarea
                  value={flow.question}
                  maxLength={4000}
                  disabled={busy}
                  onChange={(event) => update({ question: event.target.value })}
                />
              </label>
            </div>
          ) : (
            <p>{active?.question}</p>
          )}
          {error && (
            <p role="alert" className="question-add-dialog__error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="operatorOutline"
              disabled={busy}
              onClick={() => active && openQuestion(active)}
            >
              取消
            </Button>
            <Button
              variant={flow.entry === "delete" ? "destructive" : "operator"}
              disabled={
                busy ||
                (flow.entry === "edit" &&
                  (flow.question.trim().length < 2 ||
                    flow.question.trim() === active?.question))
              }
              onClick={() => void saveEdit()}
            >
              {busy
                ? "正在保存…"
                : flow.entry === "delete"
                  ? "确认删除"
                  : "保存修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!addOpen &&
        flow.entry !== "edit" &&
        flow.entry !== "delete" &&
        error && <WorkflowFeedback error>{error}</WorkflowFeedback>}
    </div>
  );
}
