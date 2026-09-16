import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./runtime-host.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import {
  KEYWORD_CATEGORY_OPTIONS,
  keywordCategoryLabel,
  type KeywordCategoryKey,
} from "../contracts/keyword-categories.js";
import type {
  QuestionIntakeDraft,
  QuestionIntakeSubmitInput,
} from "./question-intake.js";
import type { ManagedKeywordTable } from "./questions-host.js";
import { KeywordPicker, type KeywordSelection } from "./KeywordPicker.js";
import "./question-add-dialog.css";

export function QuestionAddDialog({
  open,
  allowLibrary = true,
  onOpenChange,
  initialDraft,
  tables = [],
  revision,
  libraryLoading,
  libraryError,
  onRetryLibrary,
  selectionOnly = false,
  accent = "#7545a0",
  submitting = false,
  error,
  allowed = true,
  unavailableReason,
  categoryAvailable = () => true,
  quotaDescription,
  onSubmit,
}: {
  open: boolean;
  allowLibrary?: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft?: QuestionIntakeDraft | null;
  tables?: ManagedKeywordTable[];
  revision?: number | null;
  libraryLoading?: boolean;
  libraryError?: boolean;
  onRetryLibrary?: () => void;
  selectionOnly?: boolean;
  accent?: string;
  submitting?: boolean;
  error?: string | null;
  allowed?: boolean;
  unavailableReason?: string;
  categoryAvailable?: (category: KeywordCategoryKey) => boolean;
  quotaDescription?: string;
  onSubmit: (input: QuestionIntakeSubmitInput) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"direct" | "library">("direct");
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState<KeywordCategoryKey | null>(null);
  const [selected, setSelected] = useState<KeywordSelection | null>(null);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const opened = useRef(false);
  const inFlight = useRef(false);
  const lifetime = useRef(0);
  useEffect(
    () => () => {
      lifetime.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (open && !opened.current) {
      setQuestion(
        initialDraft?.origin === "self_entered" ? initialDraft.question : "",
      );
      setCategory(
        initialDraft?.origin === "self_entered" ? initialDraft.category : null,
      );
      setSelected(
        initialDraft?.libraryRef && initialDraft.category
          ? {
              ...initialDraft.libraryRef,
              question: initialDraft.question,
              category: initialDraft.category,
            }
          : null,
      );
      setMode(
        initialDraft?.origin === "brand_keyword_library" || selectionOnly
          ? "library"
          : "direct",
      );
      setLocalError(null);
    }
    opened.current = open;
  }, [open, initialDraft, selectionOnly]);
  const busy = submitting || pending;
  const targetCategory = mode === "library" ? selected?.category : category;
  const valid =
    allowed &&
    targetCategory &&
    KEYWORD_CATEGORY_OPTIONS.some((option) => option.key === targetCategory) &&
    categoryAvailable(targetCategory) &&
    (mode === "library" ? Boolean(selected) : question.trim().length >= 2);
  const submit = async () => {
    if (!valid || inFlight.current) return;
    const generation = lifetime.current;
    inFlight.current = true;
    setPending(true);
    setLocalError(null);
    const input: QuestionIntakeSubmitInput =
      mode === "library" && selected
        ? {
            origin: "brand_keyword_library",
            question: selected.question,
            category: selected.category,
            libraryRef: {
              dashboardRevision: selected.dashboardRevision,
              tableId: selected.tableId,
              rowIndex: selected.rowIndex,
            },
          }
        : {
            origin: "self_entered",
            question: question.trim(),
            category,
            libraryRef: null,
          };
    try {
      const saved = await onSubmit(input);
      if (generation === lifetime.current && saved) onOpenChange(false);
    } catch (cause) {
      if (generation === lifetime.current)
        setLocalError(
          cause instanceof Error ? cause.message : "保存失败，请重试。",
        );
    } finally {
      if (generation === lifetime.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className={`question-add-dialog ${selectionOnly ? "question-add-dialog--selection" : ""}`}
        style={
          {
            "--module-accent": accent,
            "--module-color": accent,
          } as CSSProperties
        }
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
            {selectionOnly ? "加入优化清单" : "新增问题"}
          </DialogTitle>
          <DialogDescription>
            保存后可在优化问题中继续制作应答逻辑。
          </DialogDescription>
        </DialogHeader>
        <div className="question-add-dialog__body">
          {!selectionOnly && allowLibrary && (
            <div
              className="question-add-dialog__modes"
              role="group"
              aria-label="添加方式"
            >
              <Button
                type="button"
                variant={mode === "direct" ? "operator" : "operatorOutline"}
                aria-pressed={mode === "direct"}
                disabled={busy}
                onClick={() => setMode("direct")}
              >
                自己输入
              </Button>
              <Button
                type="button"
                variant={mode === "library" ? "operator" : "operatorOutline"}
                aria-pressed={mode === "library"}
                disabled={busy}
                onClick={() => setMode("library")}
              >
                从词库选择
              </Button>
            </div>
          )}
          {mode === "direct" ? (
            <div className="question-add-dialog__fields">
              <label>
                目标问题
                <textarea
                  value={question}
                  maxLength={4000}
                  rows={4}
                  disabled={busy}
                  placeholder="请输入一个完整、明确的问题"
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>
              <label>
                问题类别
                <select
                  value={category ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    setCategory(event.target.value as KeywordCategoryKey)
                  }
                >
                  <option value="">请选择问题类别</option>
                  {KEYWORD_CATEGORY_OPTIONS.map((item) => (
                    <option
                      key={item.key}
                      value={item.key}
                      disabled={!categoryAvailable(item.key)}
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <>
              {!selectionOnly &&
                (libraryLoading ? (
                  <p role="status">正在读取词库…</p>
                ) : libraryError ? (
                  <div role="alert">
                    词库读取失败。
                    {onRetryLibrary && (
                      <Button
                        type="button"
                        variant="operatorOutline"
                        onClick={onRetryLibrary}
                      >
                        重新读取词库
                      </Button>
                    )}
                  </div>
                ) : revision != null && tables.length ? (
                  <fieldset disabled={busy}>
                    <KeywordPicker
                      tables={tables}
                      revision={revision}
                      selected={selected}
                      onSelect={setSelected}
                    />
                  </fieldset>
                ) : (
                  <p className="question-add-dialog__note">
                    当前项目还没有词库，可以切换到自己输入。
                  </p>
                ))}
              {selected && (
                <div
                  className="question-add-dialog__selection"
                  aria-label="已选问题"
                >
                  <p>{selected.question}</p>
                  <span
                    className="fm-question-category-pill"
                    data-category={selected.category}
                  >
                    {keywordCategoryLabel(selected.category)}
                  </span>
                </div>
              )}
            </>
          )}
          {quotaDescription && (
            <p className="question-add-dialog__note">{quotaDescription}</p>
          )}
          {!allowed && (
            <p role="status">{unavailableReason || "当前不能新增问题。"}</p>
          )}
          {targetCategory && !categoryAvailable(targetCategory) && (
            <p role="status">该分类额度不足，请选择其他分类。</p>
          )}
          {(error || localError) && (
            <p className="question-add-dialog__error" role="alert">
              {error || localError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="operatorOutline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="operator"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy
              ? "正在保存…"
              : selectionOnly
                ? "确认选择并交给问题优化"
                : "加入优化清单"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
