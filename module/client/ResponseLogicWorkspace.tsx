import { BusinessExecutionActivity, captureWorkspaceRestOperation, useSearch, activeEnterpriseProjectId, FilePreview, ImagePreview, Button, trpc, createResponseLogicTask, uploadChatLocalAsset, toast, loadPreviewAdapter } from "./runtime-host.js";
import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";
import type { IntentMessage as Message } from "./host.js";
import {
  BarChart3,
  Check,
  CircleDot,
  Copy,
  FileText,
  Layers3,
  Loader2,
  MessageSquareText,
  Paperclip,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ComponentType,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  keywordCategoryKey,
  keywordCategoryTone,
} from "../contracts/keyword-categories.js";
import type {
  ConfirmedResponseLogic,
  ResponseLogicAttachment,
  ResponseLogicDraft,
  ResponseLogicImage,
  ResponseLogicRecordDto,
  SaveResponseLogicInput,
} from "../contracts/response-logic.js";
import {
  normalizeResponseLogicPublicProvenance,
  normalizeResponseLogicPublicText,
  parseResponseLogicStructuredDraft,
  responseLogicTaskStatusEnvelopeSchema,
  type ResponseLogicStructuredDraft,
  type ResponseLogicTaskStatusEnvelope,
} from "../contracts/response-logic.js";
import "./response-logic-workspace.css";
import {
  parseResponseLogicReply as parseResponseLogicReplyCore,
  getResponseLogicPollDelay as getResponseLogicPollDelayCore,
  isResponseLogicAttachmentExpired as isResponseLogicAttachmentExpiredCore,
  mergeResponseLogicAttachmentsIntoDraft as mergeResponseLogicAttachmentsIntoDraftCore,
  reconcileResponseLogicDrafts as reconcileResponseLogicDraftsCore,
} from "./response-logic-workspace.js";

export interface IntentQuestion {
  id: string;
  question: string;
  intent: string;
  summary: string;
}

export interface IntentQuestionGroup {
  id: string;
  title: string;
  subtitle: string;
  tone: "plum" | "teal" | "amber" | "blue";
  questions: IntentQuestion[];
}

/**
 * Formal workspaces never fall back to tenant/demo questions. Questions must
 * come from the service entitlement or an administrator-published dashboard.
 * Development previews inject their own data through the DEV-only preview
 * router.
 */
const EMPTY_QUESTION_GROUPS: IntentQuestionGroup[] = [];
const RESPONSE_LOGIC_FACTS_DISPLAY_HEADING =
  "企业材料/官方依据（引自知识库文档）";
const RESPONSE_LOGIC_AUTO_STASH_DEBOUNCE_MS = 700;

type LogicImage = ResponseLogicImage;
type LogicDraft = ResponseLogicDraft;
type ConfirmedLogic = ConfirmedResponseLogic;
type LogicTextField = keyof Omit<LogicDraft, "images" | "attachments">;

export type ResponseLogicWorkspaceState = {
  selectedGroupId: string;
  setSelectedGroupId: Dispatch<SetStateAction<string>>;
  selectedQuestionId: string;
  setSelectedQuestionId: Dispatch<SetStateAction<string>>;
  drafts: Record<string, LogicDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, LogicDraft>>>;
  confirmations: Record<string, ConfirmedLogic>;
  setConfirmations: Dispatch<SetStateAction<Record<string, ConfirmedLogic>>>;
  conversationIds: Record<string, string>;
  setConversationIds: Dispatch<SetStateAction<Record<string, string>>>;
  updateNotice: string;
  setUpdateNotice: Dispatch<SetStateAction<string>>;
};

export type ResponseLogicWorkspaceProps = {
  preview: boolean;
  workbench?: boolean;
  workspaceState?: ResponseLogicWorkspaceState;
  initialQuestionId?: string | null;
  onSelectedQuestionChange?: (questionId: string) => void;
  onPublished?: (questionId: string) => void;
  questionGroups?: IntentQuestionGroup[];
};

export type ResponseLogicPreviewDialogueProps = {
  question: IntentQuestion;
  onLoadLatestReply: (reply: string) => void | Promise<unknown>;
};

export type ResponseLogicPreviewAdapter = {
  createDraft: (
    question: IntentQuestion,
    group: IntentQuestionGroup,
  ) => ResponseLogicDraft;
  createPublishedConfirmation: (
    question: IntentQuestion,
    group: IntentQuestionGroup,
  ) => ConfirmedResponseLogic;
  Dialogue: ComponentType<ResponseLogicPreviewDialogueProps>;
};

function createEmptyDraft(question: IntentQuestion): LogicDraft {
  return {
    concern: question.intent,
    conclusion: "",
    facts: "",
    pending: "",
    boundaries: "",
    references: "",
    images: [],
    attachments: [],
  };
}

/**
 * Converts only a server-compatible four-section Pro response into editable
 * fields. Invalid or partial model text is rejected instead of being copied
 * into an arbitrary draft field.
 */
export function parseResponseLogicReply(
  reply: string,
): Pick<LogicDraft, LogicTextField> {
  return parseResponseLogicReplyCore(reply);
}


export class ResponseLogicTaskStatusError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly options: {
      status?: number;
      retryable?: boolean;
      stage?: "transport" | "http" | "response";
    } = {},
  ) {
    super(message);
    this.name = "ResponseLogicTaskStatusError";
  }
}

const RESPONSE_LOGIC_BINDING_FORBIDDEN_CODES = new Set([
  "RESPONSE_LOGIC_WORKSPACE_FORBIDDEN",
  "RESPONSE_LOGIC_QUESTION_FORBIDDEN",
  "RESPONSE_LOGIC_CONVERSATION_FORBIDDEN",
  "RESPONSE_LOGIC_TASK_FORBIDDEN",
  "RESPONSE_LOGIC_OPERATION_FORBIDDEN",
]);

export function isResponseLogicBindingForbiddenCode(code: string) {
  return RESPONSE_LOGIC_BINDING_FORBIDDEN_CODES.has(code);
}

export function responseLogicTaskStatusIsRetryable(
  status: number,
  code: string,
) {
  if (status === 403 && isResponseLogicBindingForbiddenCode(code)) return false;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

export function authoritativeResponseLogicTaskMatches(input: {
  records: ReadonlyArray<
    Pick<ResponseLogicRecordDto, "questionId" | "lastTaskId" | "revision">
  >;
  questionId: string;
  taskId: string;
  operationRevision: number;
}) {
  const record = input.records.find(
    (candidate) => candidate.questionId === input.questionId,
  );
  return Boolean(
    record &&
      record.lastTaskId === input.taskId &&
      record.revision === input.operationRevision,
  );
}

export function getResponseLogicPollDelay(
  elapsedMs: number,
  consecutiveFailures = 0,
) {
  return getResponseLogicPollDelayCore(elapsedMs, consecutiveFailures);
}


export async function fetchResponseLogicTaskStatus(input: {
  questionId: string;
  conversationId: string;
  taskId: string;
  operationRevision: number;
  signal?: AbortSignal;
}): Promise<ResponseLogicTaskStatusEnvelope> {
  const rest = captureWorkspaceRestOperation(input.signal);
  const query = new URLSearchParams({
    questionId: input.questionId,
    conversationId: input.conversationId,
    operationRevision: String(input.operationRevision),
  });
  let response: Response;
  try {
    response = await rest.fetch(
      `/api/response-logic/tasks/${encodeURIComponent(input.taskId)}/status?${query.toString()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ResponseLogicTaskStatusError(
      "RESPONSE_LOGIC_TASK_TRANSPORT_FAILED",
      "应答逻辑结果传输中断，系统将自动重试",
      { retryable: true, stage: "transport" },
    );
  }

  let responseText = "";
  try {
    responseText = await response.text();
    rest.assertActive();
  } catch {
    rest.assertActive();
    throw new ResponseLogicTaskStatusError(
      "RESPONSE_LOGIC_TASK_RESPONSE_READ_FAILED",
      "应答逻辑结果传输校验失败，系统将自动重试",
      { status: response.status, retryable: true, stage: "response" },
    );
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    if (response.ok) {
      throw new ResponseLogicTaskStatusError(
        "RESPONSE_LOGIC_TASK_RESPONSE_INVALID_JSON",
        "应答逻辑结果传输校验失败，系统将自动重试",
        { status: response.status, retryable: true, stage: "response" },
      );
    }
  }

  if (!response.ok) {
    const apiError =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object"
        ? payload.error
        : null;
    const message =
      apiError && "message" in apiError && typeof apiError.message === "string"
        ? apiError.message
        : `读取应答逻辑任务失败（${response.status}）`;
    const code =
      apiError && "code" in apiError && typeof apiError.code === "string"
        ? apiError.code
        : "RESPONSE_LOGIC_TASK_READ_FAILED";
    throw new ResponseLogicTaskStatusError(code, message, {
      status: response.status,
      retryable: responseLogicTaskStatusIsRetryable(response.status, code),
      stage: "http",
    });
  }

  const parsed = responseLogicTaskStatusEnvelopeSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.taskId !== input.taskId ||
    parsed.data.operationRevision !== input.operationRevision
  ) {
    throw new ResponseLogicTaskStatusError(
      "RESPONSE_LOGIC_TASK_RESPONSE_INVALID",
      "服务端返回的应答逻辑状态未通过传输协议校验",
      { status: response.status, retryable: true, stage: "response" },
    );
  }
  return parsed.data;
}

export async function fetchResponseLogicStructuredDraft(input: {
  questionId: string;
  conversationId: string;
  taskId: string;
  operationRevision: number;
}): Promise<ResponseLogicStructuredDraft> {
  const observation = await fetchResponseLogicTaskStatus(input);
  if (observation.status !== "completed") {
    throw new Error("应答逻辑任务尚未完成，请稍后重试");
  }
  return observation.structuredDraft;
}

function responseLogicAttachmentUrl(fileId: string) {
  return `/api/frontmind/v1/files/${encodeURIComponent(fileId)}`;
}

function responseLogicChatAttachment(
  attachment: ResponseLogicAttachment,
): { id: string; type: "image" | "file"; name: string; fileId: string } {
  return {
    id: `response-logic-source-${attachment.fileId}`,
    type: attachment.kind === "image" ? "image" : "file",
    name: attachment.filename,
    fileId: attachment.fileId,
  };
}

export function isResponseLogicAttachmentExpired(
  attachment: Pick<ResponseLogicAttachment, "expired" | "expiresAt">,
  now = Date.now(),
) {
  return isResponseLogicAttachmentExpiredCore(attachment, now);
}


export function mergeResponseLogicAttachmentsIntoDraft(
  draft: LogicDraft,
  attachments: ResponseLogicAttachment[],
): LogicDraft {
  return mergeResponseLogicAttachmentsIntoDraftCore(draft, attachments);
}


export function useResponseLogicWorkspaceState(
  questionGroups: IntentQuestionGroup[] = EMPTY_QUESTION_GROUPS,
): ResponseLogicWorkspaceState {
  const firstGroup = questionGroups[0];
  const firstQuestion = firstGroup?.questions[0];
  const [selectedGroupId, setSelectedGroupId] = useState(firstGroup?.id ?? "");
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    firstQuestion?.id ?? "",
  );
  const [drafts, setDrafts] = useState<Record<string, LogicDraft>>({});
  const [confirmations, setConfirmations] = useState<
    Record<string, ConfirmedLogic>
  >({});
  const [conversationIds, setConversationIds] = useState<
    Record<string, string>
  >({});
  const [updateNotice, setUpdateNotice] = useState("");

  return {
    selectedGroupId,
    setSelectedGroupId,
    selectedQuestionId,
    setSelectedQuestionId,
    drafts,
    setDrafts,
    confirmations,
    setConfirmations,
    conversationIds,
    setConversationIds,
    updateNotice,
    setUpdateNotice,
  };
}

function formatConfirmedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupIcon(tone: IntentQuestionGroup["tone"]) {
  if (tone === "teal") return Layers3;
  if (tone === "amber") return BarChart3;
  if (tone === "blue") return Search;
  return MessageSquareText;
}

function semanticGroupCategory(group: IntentQuestionGroup) {
  return keywordCategoryKey(group.id) || keywordCategoryKey(group.title);
}

function semanticGroupTone(group: IntentQuestionGroup) {
  return (
    keywordCategoryTone(group.id) ||
    keywordCategoryTone(group.title) ||
    group.tone
  );
}

type ResponseLogicPersistence = {
  records?: ResponseLogicRecordDto[];
  loading: boolean;
  ready: boolean;
  error?: string;
  retry: () => void;
  refresh: () => Promise<ResponseLogicRecordDto[]>;
  save: (
    input: SaveResponseLogicInput,
  ) => Promise<{ record: ResponseLogicRecordDto }>;
};

export function responseLogicPersistenceAvailability(input: {
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  hasData: boolean;
  errorMessage?: string;
}) {
  return {
    loading: input.isLoading,
    ready: input.isSuccess || input.hasData,
    error:
      input.isError && !input.hasData
        ? input.errorMessage || "应答逻辑数据载入失败"
        : undefined,
  };
}

function sameDraftContent(
  left: LogicDraft | null | undefined,
  right: LogicDraft | null | undefined,
) {
  if (!left || !right) return false;
  return (
    left.concern === right.concern &&
    left.conclusion === right.conclusion &&
    left.facts === right.facts &&
    left.pending === right.pending &&
    left.boundaries === right.boundaries &&
    left.references === right.references &&
    left.attachments.length === right.attachments.length &&
    left.attachments.every((attachment, index) => {
      const other = right.attachments[index];
      return (
        other &&
        attachment.fileId === other.fileId &&
        attachment.filename === other.filename
      );
    })
  );
}

/**
 * Local drafts win over record drafts while both exist; a record that was
 * removed (reset elsewhere) drops its local copy. Confirmed projections are
 * always taken from the records, which are authoritative.
 */
export function reconcileResponseLogicDrafts(
  current: Record<string, LogicDraft>,
  records: readonly ResponseLogicRecordDto[],
  previousQuestionIds: ReadonlySet<string> | null,
) {
  return reconcileResponseLogicDraftsCore(current, records, previousQuestionIds);
}


/* ---------------------------------------------------------------------------
 * Route-external generation workspace state.
 *
 * First-generation progress lives outside the component tree, keyed by
 * project + question, so navigating away and back keeps showing the running
 * task instead of losing (or double-creating) it.
 * ------------------------------------------------------------------------- */

export type ResponseLogicGenerationPhase =
  | "binding"
  | "dispatching"
  | "running"
  | "failed";

export type ResponseLogicGenerationState = {
  questionId: string;
  scope: string;
  phase: ResponseLogicGenerationPhase;
  taskId?: string;
  conversationId?: string;
  operationRevision?: number;
  startedAt?: number;
  execution?: GeneralExecutionDto;
  completedAt?: number;
  failure?: {
    message: string;
    retryable: boolean;
    retryAdoptionOnly?: boolean;
  };
};

type GenerationStoreListener = () => void;
const generationStore = new Map<string, ResponseLogicGenerationState>();
const generationListeners = new Set<GenerationStoreListener>();
let generationStoreVersion = 0;

function generationStoreKey(scope: string, questionId: string) {
  return `${scope}::${questionId}`;
}

function notifyGenerationListeners() {
  generationStoreVersion += 1;
  generationListeners.forEach((listener) => listener());
}

export function readResponseLogicGeneration(
  scope: string,
  questionId: string,
): ResponseLogicGenerationState | null {
  return generationStore.get(generationStoreKey(scope, questionId)) ?? null;
}

function setResponseLogicGeneration(
  scope: string,
  questionId: string,
  state: ResponseLogicGenerationState | null,
) {
  const key = generationStoreKey(scope, questionId);
  if (state) generationStore.set(key, state);
  else generationStore.delete(key);
  notifyGenerationListeners();
}

function useResponseLogicGeneration(
  scope: string,
  questionId: string,
): ResponseLogicGenerationState | null {
  const subscribe = useCallback((listener: GenerationStoreListener) => {
    generationListeners.add(listener);
    return () => generationListeners.delete(listener);
  }, []);
  const getVersion = useCallback(() => generationStoreVersion, []);
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return generationStore.get(generationStoreKey(scope, questionId)) ?? null;
}

/* ---------------------------------------------------------------------------
 * Serial draft-stash queue (project + question scoped).
 *
 * One write in flight at most; newer edits coalesce into the pending slot;
 * a finished request only advances the server revision baseline and never
 * overwrites later input.
 * ------------------------------------------------------------------------- */

export type ResponseLogicStashStatus = {
  state: "idle" | "scheduled" | "saving" | "error";
  message?: string;
};

class ResponseLogicStashQueue {
  baselineRevision: number;
  lastSaved: LogicDraft | null;
  private pending: LogicDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private saving = false;
  status: ResponseLogicStashStatus = { state: "idle" };

  constructor(
    readonly input: {
      scope: string;
      questionId: string;
      save: (draft: LogicDraft, expectedRevision: number) => Promise<void>;
      reconcile?: (
        content: LogicDraft,
      ) => Promise<{ revision: number; draft: LogicDraft } | null>;
      onStatus: (status: ResponseLogicStashStatus) => void;
    },
    baselineRevision: number,
    lastSaved: LogicDraft | null,
  ) {
    this.baselineRevision = baselineRevision;
    this.lastSaved = lastSaved;
  }

  enqueue(draft: LogicDraft) {
    if (sameDraftContent(draft, this.lastSaved)) {
      // Unchanged content never produces a request.
      if (!this.saving && !this.pending && !this.timer) {
        this.setStatus({ state: "idle" });
      }
      return;
    }
    this.pending = draft;
    if (this.saving) return;
    if (!this.timer) {
      this.setStatus({ state: "scheduled" });
      this.timer = setTimeout(
        () => void this.flush(),
        RESPONSE_LOGIC_AUTO_STASH_DEBOUNCE_MS,
      );
    }
  }

  /** Runs any serial work to completion (stash or an exclusive callback). */
  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => undefined);
    return run;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) return;
    while (this.pending) {
      const content = this.pending;
      this.pending = null;
      this.saving = true;
      this.setStatus({ state: "saving" });
      try {
        await this.input.save(content, this.baselineRevision);
        // Only advance the baseline; newer pending input is preserved above.
        this.lastSaved = content;
        this.setStatus(
          this.pending ? { state: "scheduled" } : { state: "idle" },
        );
      } catch (error) {
        // A failed stash keeps the local input pending and surfaces a short
        // error with retry. A revision conflict first reconciles against the
        // authoritative record: if the server already holds exactly this
        // content the response was lost, not the save.
        this.pending = content;
        let recovered: { revision: number; draft: LogicDraft } | null = null;
        try {
          recovered = (await this.input.reconcile?.(content)) ?? null;
        } catch {
          recovered = null;
        }
        if (recovered && sameDraftContent(content, recovered.draft)) {
          this.baselineRevision = recovered.revision;
          this.lastSaved = content;
        }
        this.saving = false;
        if (recovered && sameDraftContent(content, recovered.draft)) {
          if (this.pending === content) this.setStatus({ state: "idle" });
          continue;
        }
        this.setStatus({
          state: "error",
          message:
            error instanceof Error
              ? `自动暂存失败：${error.message}`
              : "自动暂存失败，输入已保留",
        });
        return;
      } finally {
        this.saving = false;
      }
    }
  }

  adoptServerRevision(revision: number, draft: LogicDraft) {
    this.baselineRevision = revision;
    this.lastSaved = draft;
  }

  pendingLocalEdits() {
    return this.pending !== null || this.timer !== null;
  }

  markFailed(message: string) {
    this.setStatus({ state: "error", message });
  }

  clearFailure() {
    if (this.status.state === "error") this.setStatus({ state: "idle" });
  }

  private setStatus(status: ResponseLogicStashStatus) {
    this.status = status;
    this.input.onStatus(status);
  }
}

const stashQueues = new Map<string, ResponseLogicStashQueue>();
const stashListeners = new Set<() => void>();
let stashVersion = 0;

function stashKey(scope: string, questionId: string) {
  return `${scope}::${questionId}`;
}

function notifyStashListeners() {
  stashVersion += 1;
  stashListeners.forEach((listener) => listener());
}

function useStashQueueStatus() {
  const subscribe = useCallback((listener: () => void) => {
    stashListeners.add(listener);
    return () => stashListeners.delete(listener);
  }, []);
  const getVersion = useCallback(() => stashVersion, []);
  useSyncExternalStore(subscribe, getVersion, getVersion);
}

/* ---------------------------------------------------------------------------
 * Dedicated response-logic client endpoints (adoption + materials).
 * ------------------------------------------------------------------------- */

export type AdoptResponseLogicResultOutcome = {
  adopted: boolean;
  resultId: string;
  record: ResponseLogicRecordDto;
};

async function readResponseLogicError(response: Response) {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const envelope =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const error =
    envelope.error && typeof envelope.error === "object"
      ? (envelope.error as Record<string, unknown>)
      : {};
  return {
    code: typeof error.code === "string" ? error.code : "RESPONSE_LOGIC_REQUEST_FAILED",
    message:
      typeof error.message === "string"
        ? error.message
        : `请求失败（${response.status}）`,
    resultId: typeof error.resultId === "string" ? error.resultId : undefined,
    status: response.status,
  };
}

export async function adoptResponseLogicModelResultRequest(input: {
  questionId: string;
  conversationId: string;
  taskId: string;
  resultId: string;
  operationRevision: number;
}): Promise<AdoptResponseLogicResultOutcome> {
  const rest = captureWorkspaceRestOperation();
  let response: Response;
  try {
    response = await rest.fetch("/api/response-logic/adopt-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    rest.assertActive();
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ResponseLogicTaskStatusError(
      "RESPONSE_LOGIC_ADOPT_TRANSPORT_FAILED",
      "采用应答逻辑结果时连接中断，请稍后重试",
      { retryable: true, stage: "transport" },
    );
  }
  if (!response.ok) {
    const failure = await readResponseLogicError(response);
    throw Object.assign(
      new ResponseLogicTaskStatusError(failure.code, failure.message, {
        status: failure.status,
        retryable: failure.status >= 500 || failure.status === 429,
        stage: "http",
      }),
      failure.resultId ? { supersededResultId: failure.resultId } : {},
    );
  }
  const payload = (await response.json()) as {
    adopted?: unknown;
    resultId?: unknown;
    record?: unknown;
  };
  if (typeof payload.resultId !== "string" || !payload.record) {
    throw new ResponseLogicTaskStatusError(
      "RESPONSE_LOGIC_ADOPT_RESPONSE_INVALID",
      "采用应答逻辑结果的响应未通过校验，请稍后重试",
      { retryable: true, stage: "response" },
    );
  }
  return {
    adopted: payload.adopted === true,
    resultId: payload.resultId,
    record: payload.record as ResponseLogicRecordDto,
  };
}

export async function updateResponseLogicMaterialsRequest(input: {
  questionId: string;
  expectedRevision: number;
  addAssetIds: string[];
  removeAssetIds: string[];
}): Promise<ResponseLogicRecordDto> {
  const rest = captureWorkspaceRestOperation();
  let response: Response;
  try {
    response = await rest.fetch("/api/response-logic/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    rest.assertActive();
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new Error("更新应答逻辑材料时连接中断，请稍后重试");
  }
  if (!response.ok) {
    const failure = await readResponseLogicError(response);
    throw new Error(failure.message);
  }
  const payload = (await response.json()) as { record?: unknown };
  if (!payload.record) throw new Error("材料更新响应未通过校验，请稍后重试");
  return payload.record as ResponseLogicRecordDto;
}

function generationPrompt(question: string) {
  return `请基于最新企业知识库，为“${question}”生成可核验的应答逻辑。`;
}

function buildGenerationMessages(
  question: string,
  attachments: readonly ResponseLogicAttachment[],
): Message[] {
  const content: Message["content"] = [
    { type: "input_text", text: generationPrompt(question) },
    ...attachments.map((attachment) => ({
      type: attachment.kind === "image" ? ("input_image" as const) : ("input_file" as const),
      file_id: attachment.fileId,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
    })),
  ];
  return [{ role: "user", content }];
}

function draftPlainText(draft: LogicDraft) {
  return [
    `## 用户真实关心\n\n${draft.concern}`,
    `## 核心结论/执行口径\n\n${draft.conclusion}`,
    `## 企业材料/官方依据\n\n${draft.facts}`,
    `## 回答边界/禁止表达\n\n${draft.boundaries}`,
  ].join("\n\n");
}

/* ---------------------------------------------------------------------------
 * Workspace entry points.
 * ------------------------------------------------------------------------- */

export default function ResponseLogicWorkspace(
  props: ResponseLogicWorkspaceProps,
) {
  if (!props.questionGroups?.length)
    return <ResponseLogicMissingQuestionState />;
  if (props.preview) {
    return (
      <DevelopmentResponseLogicWorkspace {...props} />
    );
  }
  return <PersistentResponseLogicWorkspace {...props} />;
}

function ResponseLogicMissingQuestionState() {
  return (
    <ResponseLogicConfirmationState
      title="请从优化问题清单进入"
      description="应答逻辑按问题逐一编辑；请先在优化问题清单中选择具体问题。"
    />
  );
}

function useResponseLogicPreviewAdapter(enabled: boolean) {
  const [adapter, setAdapter] = useState<ResponseLogicPreviewAdapter | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    if (!enabled) return;
    void loadPreviewAdapter()
      .then((loadedAdapter) => {
        if (active) setAdapter(loadedAdapter);
      })
      .catch(() => {
        if (active) setAdapter(null);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return adapter;
}

function DevelopmentResponseLogicWorkspace(props: ResponseLogicWorkspaceProps) {
  const previewAdapter = useResponseLogicPreviewAdapter(true);
  if (!previewAdapter) {
    return (
      <ResponseLogicConfirmationState
        title="正在载入开发预览"
        description="正在读取本地匿名验收数据。"
        loading
      />
    );
  }
  return (
    <PreviewResponseLogicEditor
      {...props}
      previewAdapter={previewAdapter}
    />
  );
}

function PreviewResponseLogicEditor({
  questionGroups,
  initialQuestionId,
  previewAdapter,
}: ResponseLogicWorkspaceProps & {
  previewAdapter: ResponseLogicPreviewAdapter;
}) {
  const search = useSearch();
  const linkedQuestion = new URLSearchParams(search).get("questionId");
  const questionId = initialQuestionId ?? linkedQuestion;
  const entries = useMemo(
    () =>
      (questionGroups ?? []).flatMap((group) =>
        group.questions.map((question) => ({ group, question })),
      ),
    [questionGroups],
  );
  const entry = entries.find((item) => item.question.id === questionId);
  const [draft, setDraft] = useState<LogicDraft>(() =>
    entry
      ? previewAdapter.createDraft(entry.question, entry.group)
      : createEmptyDraft({ id: "", question: "", intent: "", summary: "" }),
  );
  if (!entry) return <ResponseLogicMissingQuestionState />;
  return (
    <section className="rl-single-page">
      <ResponseLogicPageHeader group={entry.group} question={entry.question} />
      <LogicEditorCard
        draft={draft}
        frozen={false}
        publishing={false}
        stashStatus={{ state: "idle" }}
        dirty={false}
        onPatch={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onPublish={() => undefined}
        onCopy={() => undefined}
        uploadingMaterials={false}
        onAddMaterials={() => undefined}
        onRemoveMaterial={() => undefined}
      />
    </section>
  );
}

function PersistentResponseLogicWorkspace(props: ResponseLogicWorkspaceProps) {
  const utils = trpc.useUtils();
  const recordsQuery = trpc.workspace.responseLogic.useQuery(undefined, {
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const saveMutation = trpc.workspace.saveResponseLogic.useMutation({
    onSuccess: ({ record }) => {
      utils.workspace.responseLogic.setData(undefined, (current) => {
        const records = current?.records || [];
        const nextRecords = records.some(
          (item) => item.questionId === record.questionId,
        )
          ? records.map((item) =>
              item.questionId === record.questionId ? record : item,
            )
          : [...records, record];
        return { records: nextRecords };
      });
    },
  });
  const availability = responseLogicPersistenceAvailability({
    isLoading: recordsQuery.isLoading,
    isFetching: recordsQuery.isFetching,
    isSuccess: recordsQuery.isSuccess,
    isError: recordsQuery.isError,
    hasData: Boolean(recordsQuery.data),
    errorMessage: recordsQuery.error?.message,
  });
  return (
    <ResponseLogicWorkspaceContent
      {...props}
      persistence={{
        records: recordsQuery.data?.records,
        ...availability,
        retry: () => {
          void recordsQuery.refetch();
        },
        refresh: async () => {
          const result = await recordsQuery.refetch();
          if (result.error) throw result.error;
          return result.data?.records ?? [];
        },
        save: (input) => saveMutation.mutateAsync(input),
      }}
    />
  );
}

function ResponseLogicConfirmationState({
  title,
  description,
  actionLabel,
  onAction,
  loading = false,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}) {
  return (
    <section className="rl-empty-state" aria-busy={loading}>
      <span className="rl-empty-icon">
        <FileText size={22} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel && onAction && (
        <Button variant="operator" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </section>
  );
}

function ResponseLogicPageHeader({
  group,
  question,
}: {
  group: IntentQuestionGroup;
  question: IntentQuestion;
}) {
  const tone = semanticGroupTone(group);
  const category = semanticGroupCategory(group);
  return (
    <header className="rl-page-head" data-tone={tone} data-category={category || undefined}>
      <div className="rl-page-head-main">
        <div className="rl-page-head-meta">
          <span className="rl-page-group">
            {group.title} · {group.subtitle}
          </span>
          <span className="rl-page-question">{question.question}</span>
        </div>
      </div>
    </header>
  );
}

function ResponseLogicWorkspaceContent({
  initialQuestionId,
  onSelectedQuestionChange,
  questionGroups,
  persistence,
}: ResponseLogicWorkspaceProps & {
  persistence: ResponseLogicPersistence | null;
}) {
  const search = useSearch();
  const linkedQuestion = new URLSearchParams(search).get("questionId");
  const requestedQuestion = initialQuestionId ?? linkedQuestion;
  const groups = questionGroups ?? EMPTY_QUESTION_GROUPS;
  const questionEntries = useMemo(
    () =>
      groups.flatMap((group) =>
        group.questions.map((question) => ({ group, question })),
      ),
    [groups],
  );
  const questionEntryById = useMemo(
    () => new Map(questionEntries.map((entry) => [entry.question.id, entry])),
    [questionEntries],
  );

  useEffect(() => {
    if (requestedQuestion) onSelectedQuestionChange?.(requestedQuestion);
  }, [requestedQuestion, onSelectedQuestionChange]);

  if (!persistence) return <ResponseLogicMissingQuestionState />;

  // A missing or invalid question id shows the way back to the question list;
  // another question is never auto-selected in its place.
  const selectedEntry = requestedQuestion
    ? questionEntryById.get(requestedQuestion)
    : undefined;
  if (!selectedEntry) return <ResponseLogicMissingQuestionState />;
  if (!persistence?.ready && persistence?.loading) {
    return (
      <ResponseLogicConfirmationState
        title="正在载入应答逻辑"
        description="正在读取当前问题的应答逻辑记录。"
        loading
      />
    );
  }
  if (persistence?.error) {
    return (
      <ResponseLogicConfirmationState
        title="应答逻辑载入失败"
        description={persistence.error}
        actionLabel="重试"
        onAction={persistence.retry}
      />
    );
  }

  return (
    <ResponseLogicQuestionEditor
      key={selectedEntry.question.id}
      group={selectedEntry.group}
      question={selectedEntry.question}
      persistence={persistence}
    />
  );
}

function ResponseLogicQuestionEditor({
  group,
  question,
  persistence,
}: {
  group: IntentQuestionGroup;
  question: IntentQuestion;
  persistence: ResponseLogicPersistence;
}) {
  const scope = activeEnterpriseProjectId() ?? "account";
  const questionId = question.id;
  const generation = useResponseLogicGeneration(scope, questionId);
  useStashQueueStatus();
  const [localDraft, setLocalDraft] = useState<LogicDraft | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishNotice, setPublishNotice] = useState("");
  const [uploadingMaterials, setUploadingMaterials] = useState(false);
  const [stashStatus, setStashStatus] = useState<ResponseLogicStashStatus>({
    state: "idle",
  });
  const startLock = useRef(false);

  const persistedRecord = persistence.records?.find(
    (record) => record.questionId === questionId,
  );
  const recordDraft = persistedRecord?.draft ?? null;
  const draft = localDraft ?? recordDraft ?? createEmptyDraft(question);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const recordRef = useRef(persistedRecord);
  recordRef.current = persistedRecord;
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  const generationRef = useRef(generation);
  generationRef.current = generation;

  const generating =
    (generation?.phase === "binding" ||
      generation?.phase === "dispatching" ||
      generation?.phase === "running") &&
    // A completed generation keeps its process card visible but must reopen
    // the editor for manual edits immediately.
    !generation?.completedAt;

  const questionFields = useCallback(
    (extra: Partial<SaveResponseLogicInput> = {}): SaveResponseLogicInput => ({
      questionId,
      groupId: group.id,
      groupTitle: group.title,
      question: question.question,
      intent: question.intent,
      summary: question.summary,
      expectedRevision: recordRef.current?.revision ?? 0,
      draft: draftRef.current,
      publish: false,
      ...extra,
    }),
    [group.id, group.title, question, questionId],
  );
  const questionFieldsRef = useRef(questionFields);
  questionFieldsRef.current = questionFields;

  const stashQueue = useMemo(() => {
    const key = stashKey(scope, questionId);
    const existing = stashQueues.get(key);
    if (existing) {
      return existing;
    }
    const queue = new ResponseLogicStashQueue(
      {
        scope,
        questionId,
        onStatus: (status) => {
          setStashStatus(status);
          notifyStashListeners();
        },
        save: async (content, expectedRevision) => {
          const { record } = await persistenceRef.current.save(
            questionFieldsRef.current({
              draft: content,
              expectedRevision,
            }),
          );
          // The response is the only authority for the next baseline; a
          // stale cache must never cause a conflicting follow-up write.
          queue.baselineRevision = record.revision;
          queue.lastSaved = content;
          setLocalDraft((current) =>
            current && sameDraftContent(current, content) ? record.draft : current,
          );
        },
        reconcile: async (content) => {
          const records = await persistenceRef
            .current.refresh()
            .catch(() => null);
          const latest =
            records?.find((item) => item.questionId === questionId) ?? null;
          if (!latest) return null;
          return { revision: latest.revision, draft: latest.draft };
        },
      },
      recordRef.current?.revision ?? 0,
      recordRef.current?.draft ?? null,
    );
    stashQueues.set(key, queue);
    return queue;
  }, [questionId, scope]);

  // Keep the queue baseline aligned with the authoritative record between
  // mounts; local unsent edits always win over the baseline refresh.
  if (persistedRecord && !stashQueue.pendingLocalEdits() && stashQueue.status.state !== "saving") {
    stashQueue.adoptServerRevision(
      persistedRecord.revision,
      persistedRecord.draft,
    );
  }
  stashQueue.input.onStatus = (status) => {
    setStashStatus(status);
    notifyStashListeners();
  };

  const patchDraft = (patch: Partial<LogicDraft>) => {
    if (generating || publishing) return;
    setLocalDraft((current) => ({
      ...(current ?? draftRef.current),
      ...patch,
    }));
  };

  // Auto-stash: debounce 700ms after the last input, one request in flight.
  useEffect(() => {
    if (generating || publishing) return;
    if (!localDraft) return;
    stashQueue.enqueue(localDraft);
  }, [localDraft, generating, publishing, stashQueue]);

  useEffect(() => {
    if (!generating) return;
    stashQueue.clearFailure();
  }, [generating, stashQueue]);

  // Navigation away must complete pending stashing; closing the tab warns.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        stashQueue.status.state === "saving" ||
        stashQueue.status.state === "scheduled" ||
        stashQueue.pendingLocalEdits()
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      void stashQueue.flush();
    };
  }, [stashQueue]);

  /** Record content is authoritative; local edits cannot exist here. */
  const applyAuthoritativeRecord = useCallback(
    (record: ResponseLogicRecordDto) => {
      stashQueue.adoptServerRevision(record.revision, record.draft);
      setLocalDraft(record.draft);
    },
    [stashQueue],
  );

  /** Material changes only replace attachments/images, keeping local text. */
  const applyMaterialsRecord = useCallback(
    (record: ResponseLogicRecordDto) => {
      stashQueue.adoptServerRevision(record.revision, record.draft);
      setLocalDraft((current) =>
        current
          ? {
              ...current,
              attachments: record.draft.attachments,
              images: record.draft.images,
            }
          : record.draft,
      );
    },
    [stashQueue],
  );

  const refreshQuestionRecord = useCallback(async () => {
    const records = await persistenceRef.current.refresh();
    return records.find((record) => record.questionId === questionId) ?? null;
  }, [questionId]);

  /* ------------------------------ first generation ----------------------- */

  const startGeneration = useCallback(async () => {
    if (startLock.current || generationRef.current) return;
    startLock.current = true;
    setPublishError("");
    setPublishNotice("");
    const startedAt = Date.now();
    const write = (state: ResponseLogicGenerationState) =>
      setResponseLogicGeneration(scope, questionId, state);
    try {
      write({
        questionId,
        scope,
        phase: "binding",
        startedAt,
      });
      // Ensure a server record bound to a dedicated conversation exists.
      let record = recordRef.current ?? null;
      if (!record || !record.conversationId) {
        const conversationId =
          record?.conversationId ??
          `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const saved = await persistenceRef.current.save(
          questionFieldsRef.current({
            conversationId,
            expectedRevision: record?.revision ?? 0,
          }),
        );
        record = saved.record;
        applyAuthoritativeRecord(saved.record);
      }
      const conversationId = record.conversationId!;
      const operationRevision = record.revision;
      if (operationRevision < 1)
        throw new Error("应答逻辑记录尚未就绪，请稍后重试");
      write({
        questionId,
        scope,
        phase: "dispatching",
        startedAt,
        conversationId,
        operationRevision,
      });
      const task = await createResponseLogicTask(
        buildGenerationMessages(question.question, record.draft.attachments),
        {
          questionId,
          groupId: group.id,
          groupTitle: group.title,
          question: question.question,
          intent: question.intent,
          summary: question.summary,
          draft: record.draft,
          operationRevision,
          conversationId,
        },
      );
      write({
        questionId,
        scope,
        phase: "running",
        startedAt,
        taskId: task.id,
        conversationId,
        operationRevision: task.operationRevision,
        execution: task.execution,
      });
      void persistenceRef.current.refresh().catch(() => undefined);
    } catch (error) {
      const unknownOutcome =
        error instanceof Error && "code" in error &&
        [
          "RESPONSE_LOGIC_START_OUTCOME_UNKNOWN",
          "RESPONSE_LOGIC_START_RESPONSE_INVALID",
        ].includes(String(error.code));
      if (unknownOutcome) {
        // Query the current operation instead of re-creating a paid task.
        try {
          const latest = await refreshQuestionRecord();
          if (latest?.lastTaskId && latest.conversationId) {
            write({
              questionId,
              scope,
              phase: "running",
              startedAt,
              taskId: latest.lastTaskId,
              conversationId: latest.conversationId,
              operationRevision: latest.revision,
            });
            return;
          }
        } catch {
          // fall through to the failure state
        }
      }
      write({
        questionId,
        scope,
        phase: "failed",
        startedAt,
        failure: {
          message:
            error instanceof Error ? error.message : "应答逻辑生成失败，请重试",
          retryable: true,
        },
      });
    } finally {
      startLock.current = false;
    }
  }, [
    applyAuthoritativeRecord,
    group.id,
    group.title,
    question,
    questionId,
    refreshQuestionRecord,
    scope,
  ]);

  const adoptCompletedObservationRef = useRef<
    (
      observation: Extract<
        ResponseLogicTaskStatusEnvelope,
        { status: "completed" }
      >,
      attempt?: number,
    ) => Promise<void>
  >(async () => undefined);
  adoptCompletedObservationRef.current = async (observation, attempt = 0) => {
    const context = generationRef.current;
    if (
      !context ||
      !context.taskId ||
      !context.conversationId ||
      !context.operationRevision
    )
      return;
    const finish = (completed: boolean) =>
      setResponseLogicGeneration(scope, questionId, {
        ...context,
        ...(completed ? { completedAt: Date.now() } : {}),
        execution: observation.execution,
      });
    try {
      const outcome = await adoptResponseLogicModelResultRequest({
        questionId,
        conversationId: context.conversationId,
        taskId: context.taskId,
        resultId: observation.resultId,
        operationRevision: context.operationRevision,
      });
      applyAuthoritativeRecord(outcome.record);
      finish(true);
    } catch (error) {
      const supersededResultId = (
        error as { supersededResultId?: string }
      ).supersededResultId;
      if (supersededResultId && attempt < 2) {
        const next = await fetchResponseLogicTaskStatus({
          questionId,
          conversationId: context.conversationId,
          taskId: context.taskId,
          operationRevision: context.operationRevision,
        });
        if (next.status === "completed") {
          return adoptCompletedObservationRef.current(next, attempt + 1);
        }
      }
      // Adoption conflicts resolve against the authoritative record first.
      const latest = await refreshQuestionRecord().catch(() => null);
      if (latest?.appliedModelResult) {
        applyAuthoritativeRecord(latest);
        setResponseLogicGeneration(scope, questionId, null);
        return;
      }
      setResponseLogicGeneration(scope, questionId, {
        ...context,
        phase: "failed",
        execution: observation.execution,
        failure: {
          message:
            error instanceof Error
              ? error.message
              : "采用应答逻辑结果失败，请重试",
          retryable: true,
          retryAdoptionOnly: true,
        },
      });
    }
  };

  // Poll the running first-generation task directly under the question.
  const pollPhase = generation?.phase;
  const pollTaskId = generation?.taskId;
  const pollConversationId = generation?.conversationId;
  const pollOperationRevision = generation?.operationRevision;
  const pollStartedAt = generation?.startedAt;
  const pollCompletedAt = generation?.completedAt;
  useEffect(() => {
    if (pollPhase !== "running") return;
    if (!pollTaskId || !pollConversationId || !pollOperationRevision) return;
    if (pollCompletedAt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      try {
        const observation = await fetchResponseLogicTaskStatus({
          questionId,
          conversationId: pollConversationId,
          taskId: pollTaskId,
          operationRevision: pollOperationRevision,
        });
        if (cancelled) return;
        failures = 0;
        if (observation.status === "completed") {
          await adoptCompletedObservationRef.current(observation);
          return;
        }
        const current = generationRef.current;
        if (current && current.phase === "running") {
          setResponseLogicGeneration(scope, questionId, {
            ...current,
            execution: observation.execution,
          });
        }
        schedule(
          getResponseLogicPollDelay(Date.now() - (pollStartedAt ?? Date.now())),
        );
      } catch (error) {
        if (cancelled) return;
        if (
          error instanceof ResponseLogicTaskStatusError &&
          error.options.retryable === false
        ) {
          // Binding forbidden or task failed: use the authoritative record.
          const latest = await refreshQuestionRecord().catch(() => null);
          if (latest?.appliedModelResult) {
            applyAuthoritativeRecord(latest);
            setResponseLogicGeneration(scope, questionId, null);
            return;
          }
          const current = generationRef.current;
          setResponseLogicGeneration(scope, questionId, {
            ...(current ?? {
              questionId,
              scope,
              phase: "running",
              taskId: pollTaskId,
              conversationId: pollConversationId,
              operationRevision: pollOperationRevision,
            }),
            phase: "failed",
            failure: {
              message:
                error instanceof Error ? error.message : "应答逻辑任务失败",
              retryable: true,
            },
          });
          return;
        }
        failures += 1;
        schedule(
          getResponseLogicPollDelay(
            Date.now() - (pollStartedAt ?? Date.now()),
            failures,
          ),
        );
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    applyAuthoritativeRecord,
    pollCompletedAt,
    pollConversationId,
    pollOperationRevision,
    pollPhase,
    pollStartedAt,
    pollTaskId,
    questionId,
    refreshQuestionRecord,
    scope,
  ]);

  /* ------------------------------ formal update -------------------------- */

  // "Unpublished changes", not "unsaved changes": fully stashed edits that
  // differ from the published confirmation (or exist without one) must keep
  // the formal update action available.
  const dirty =
    (draft.concern.trim() !== "" || draft.conclusion.trim() !== "") &&
    (!persistedRecord?.confirmed ||
      !sameDraftContent(draft, persistedRecord.confirmed));

  const publishDraft = useCallback(async () => {
    if (publishing || generating) return;
    setPublishing(true);
    setPublishError("");
    setPublishNotice("");
    try {
      // Wait for any in-flight stash/material work before freezing content.
      await stashQueue.runExclusive(() => stashQueue.flush());
      const frozenDraft = draftRef.current;
      const publicationRequestId = crypto.randomUUID();
      const { record } = await persistenceRef.current.save(
        questionFieldsRef.current({
          draft: frozenDraft,
          expectedRevision: stashQueue.baselineRevision,
          publish: true,
          publicationRequestId,
        }),
      );
      applyAuthoritativeRecord(record);
      setPublishNotice("应答逻辑已更新");
    } catch (error) {
      // The previous formal version and the local edits are both preserved.
      setPublishError(
        error instanceof Error ? error.message : "更新应答逻辑失败，请重试",
      );
    } finally {
      setPublishing(false);
    }
  }, [applyAuthoritativeRecord, generating, publishing, stashQueue]);

  const copyDraft = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(draftPlainText(draftRef.current));
      toast.success("已复制应答逻辑内容");
    } catch {
      toast.error("复制失败，请手动选择内容复制");
    }
  }, []);

  /* ------------------------------ materials ------------------------------ */

  const addMaterials = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || generating || publishing) return;
      setUploadingMaterials(true);
      setPublishError("");
      try {
        const assetIds: string[] = [];
        for (const file of Array.from(files)) {
          const uploaded = await uploadChatLocalAsset(file);
          assetIds.push(uploaded.fileId);
        }
        const record = await stashQueue.runExclusive(async () => {
          await stashQueue.flush();
          return updateResponseLogicMaterialsRequest({
            questionId,
            expectedRevision: stashQueue.baselineRevision,
            addAssetIds: assetIds,
            removeAssetIds: [],
          });
        });
        applyMaterialsRecord(record);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "材料上传失败，请重试",
        );
      } finally {
        setUploadingMaterials(false);
      }
    },
    [applyMaterialsRecord, generating, publishing, questionId, stashQueue],
  );

  const removeMaterial = useCallback(
    async (fileId: string) => {
      if (generating || publishing) return;
      try {
        const record = await stashQueue.runExclusive(async () => {
          await stashQueue.flush();
          return updateResponseLogicMaterialsRequest({
            questionId,
            expectedRevision: stashQueue.baselineRevision,
            addAssetIds: [],
            removeAssetIds: [fileId],
          });
        });
        applyMaterialsRecord(record);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "材料移除失败，请重试",
        );
      }
    },
    [generating, publishing, questionId, stashQueue],
  );

  const hasAdoptedContent = Boolean(
    persistedRecord?.appliedModelResult || persistedRecord?.draft.conclusion,
  );
  const showGenerationEntry =
    !generating && !hasAdoptedContent && !generation;
  const showGenerationProcess =
    generating ||
    Boolean(generation?.completedAt) ||
    generation?.phase === "failed";

  return (
    <section className="rl-single-page">
      <ResponseLogicPageHeader
        group={group}
        question={question}
      />

      {showGenerationEntry && (
        <section className="rl-generation-card" aria-label="生成应答">
          <div className="rl-generation-card-main">
            <span className="rl-generation-icon">
              <Sparkles size={20} />
            </span>
            <div>
              <h3>首次生成应答逻辑</h3>
              <p>
                基于最新企业知识库与已绑定材料生成四栏目草稿；生成完成后可继续人工修改。
              </p>
            </div>
          </div>
          <div className="rl-generation-card-actions">
            <label className="rl-material-upload-inline">
              <input
                hidden
                multiple
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md"
                disabled={generating || publishing || uploadingMaterials}
                onChange={(event) => {
                  void addMaterials(event.target.files);
                  event.target.value = "";
                }}
              />
              <Paperclip size={15} />
              添加参考材料
            </label>
            <button
              type="button"
              className="rl-primary-button"
              disabled={generating || publishing}
              onClick={() => void startGeneration()}
            >
              <Sparkles size={15} />
              生成应答
            </button>
          </div>
        </section>
      )}

      {showGenerationProcess && generation && (
        <section className="rl-process-card" aria-label="应答生成过程">
          <div className="rl-process-head">
            {generation.phase === "running" && !generation.completedAt ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <strong>正在生成应答逻辑…</strong>
                <span>生成期间材料与正文修改已冻结</span>
              </>
            ) : generation.phase === "failed" ? (
              <>
                <CircleDot size={15} />
                <strong>生成未完成</strong>
                <span>{generation.failure?.message}</span>
              </>
            ) : (
              <>
                <Check size={15} />
                <strong>已生成并进入编辑</strong>
                <span>过程默认折叠，正文可直接修改</span>
              </>
            )}
            {generation.phase === "failed" && (
              <button
                type="button"
                className="rl-primary-button"
                onClick={() => {
                  if (generation.failure?.retryAdoptionOnly) {
                    setResponseLogicGeneration(scope, questionId, {
                      ...generation,
                      phase: "running",
                      failure: undefined,
                    });
                  } else {
                    setResponseLogicGeneration(scope, questionId, null);
                    void startGeneration();
                  }
                }}
              >
                重试
              </button>
            )}
          </div>
          {generation.execution && (
            <BusinessExecutionActivity execution={generation.execution} />
          )}
        </section>
      )}

      {(generating || publishing) && !showGenerationProcess && (
        <section className="rl-process-card" aria-label="处理中">
          <div className="rl-process-head">
            <Loader2 size={15} className="animate-spin" />
            <strong>
              {generating ? "正在准备生成…" : "正在更新应答逻辑…"}
            </strong>
          </div>
        </section>
      )}

      <LogicEditorCard
        draft={draft}
        frozen={generating || publishing}
        publishing={publishing}
        stashStatus={stashStatus}
        dirty={dirty}
        onPatch={patchDraft}
        onPublish={() => void publishDraft()}
        onCopy={() => void copyDraft()}
        uploadingMaterials={uploadingMaterials}
        onAddMaterials={(event) => {
          void addMaterials(event.target.files);
          event.target.value = "";
        }}
        onRemoveMaterial={(fileId) => void removeMaterial(fileId)}
      />

      {(publishError || stashStatus.state === "error") && (
        <div className="rl-single-page-footer-error" role="alert">
          {publishError || stashStatus.message}
          {stashStatus.state === "error" && (
            <button
              type="button"
              className="rl-text-button"
              onClick={() => {
                stashQueue.clearFailure();
                stashQueue.enqueue(draftRef.current);
              }}
            >
              重试暂存
            </button>
          )}
        </div>
      )}
      {publishNotice && (
        <div className="rl-single-page-footer-notice" role="status">
          {publishNotice}
        </div>
      )}
    </section>
  );
}

function LogicEditorCard({
  draft,
  frozen,
  publishing,
  stashStatus,
  dirty,
  onPatch,
  onPublish,
  onCopy,
  uploadingMaterials,
  onAddMaterials,
  onRemoveMaterial,
}: {
  draft: LogicDraft;
  frozen: boolean;
  publishing: boolean;
  stashStatus: ResponseLogicStashStatus;
  dirty: boolean;
  onPatch: (patch: Partial<LogicDraft>) => void;
  onPublish: () => void;
  onCopy: () => void;
  uploadingMaterials: boolean;
  onAddMaterials: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveMaterial: (fileId: string) => void;
}) {
  const stashLabel =
    stashStatus.state === "saving"
      ? "正在暂存…"
      : stashStatus.state === "scheduled"
        ? "待暂存…"
        : stashStatus.state === "error"
          ? stashStatus.message || "暂存失败"
          : dirty
            ? "修改后自动暂存"
            : "已暂存";
  const sourceFiles = draft.attachments.filter(
    (attachment) =>
      attachment.kind === "file" ||
      isResponseLogicAttachmentExpired(attachment),
  );
  const uploadedImageAttachments = new Map<string, ResponseLogicAttachment>(
    draft.attachments
      .filter((attachment) => attachment.kind === "image")
      .map(
        (attachment) =>
          [`response-logic-upload-${attachment.fileId}`, attachment] as const,
      ),
  );
  return (
    <section className="rl-editor-card rl-editor-card--single">
      <div className="rl-card-title">
        <div>
          <span className="rl-title-icon">
            <FileText size={17} />
          </span>
          <div>
            <h3>应答逻辑编辑</h3>
            <p>修改自动暂存；点击“更新应答逻辑”后正式生效。</p>
          </div>
        </div>
      </div>
      <fieldset className="rl-editor-scroll" disabled={frozen}>
        <EditorField
          index="01"
          label="用户真实关心"
          value={draft.concern}
          onChange={(concern) => onPatch({ concern })}
          rows={3}
        />
        <EditorField
          index="02"
          label="核心结论/执行口径"
          value={draft.conclusion}
          onChange={(conclusion) => onPatch({ conclusion })}
          rows={8}
        />
        <EditorField
          index="03"
          label={RESPONSE_LOGIC_FACTS_DISPLAY_HEADING}
          hint="事实依据每行一项，后续应与可追溯来源一一对应"
          value={draft.facts}
          onChange={(facts) => onPatch({ facts })}
          rows={5}
        />
        <EditorField
          index="04"
          label="回答边界/禁止表达"
          value={draft.boundaries}
          onChange={(boundaries) => onPatch({ boundaries })}
          rows={5}
        />
        <div className="rl-editor-field rl-image-field">
          <div className="rl-editor-label">
            <span>05</span>
            <div>
              <strong>图文依据</strong>
              <small>
                上传后直接绑定当前问题草稿；生成完成后增删材料不会再次调用模型。
              </small>
            </div>
          </div>
          {!frozen && (
            <label className="rl-image-upload">
              <input
                hidden
                multiple
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md"
                disabled={uploadingMaterials}
                onChange={onAddMaterials}
              />
              <Upload size={18} />
              <span>
                <strong>上传图片或资料</strong>
                <small>
                  {uploadingMaterials ? "正在上传…" : "直接绑定当前问题，无需发送消息"}
                </small>
              </span>
            </label>
          )}
          {(sourceFiles.length > 0 || draft.attachments.some((a) => a.kind === "image")) && (
            <div className="rl-source-files" aria-label="已绑定材料">
              <strong>已绑定材料</strong>
              {draft.attachments.map((attachment) => (
                <div key={attachment.fileId} className="rl-material-row">
                  {attachment.kind === "image" ? (
                    <ImagePreview
                      fileId={attachment.fileId}
                      alt={attachment.filename}
                      expiresAt={attachment.expiresAt}
                      expired={attachment.expired}
                      className="rl-owned-image-preview-editor"
                    />
                  ) : (
                    <FilePreview
                      file={responseLogicChatAttachment(attachment)}
                      className="w-full"
                    />
                  )}
                  {!frozen && (
                    <button
                      type="button"
                      className="rl-delete-image"
                      aria-label={`移除 ${attachment.filename}`}
                      disabled={uploadingMaterials}
                      onClick={() => onRemoveMaterial(attachment.fileId)}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {draft.images
            .filter((image) => !uploadedImageAttachments.has(image.id))
            .length > 0 && (
            <div className="rl-image-editor-list">
              {draft.images
                .filter((image) => !uploadedImageAttachments.has(image.id))
                .map((image) => (
                  <div className="rl-image-editor" key={image.id}>
                    <img src={image.url} alt={image.caption || image.name} />
                    <div className="rl-image-meta-editor">
                      <strong>{image.caption || image.name}</strong>
                      {!frozen && <span>已加入当前应答逻辑</span>}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </fieldset>
      <div className="rl-sticky-actions">
        <button
          type="button"
          className="rl-primary-button rl-sticky-primary"
          disabled={frozen || publishing || !dirty}
          onClick={onPublish}
        >
          {publishing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ShieldCheck size={16} />
          )}
          {publishing ? "正在更新…" : "更新应答逻辑"}
        </button>
        <span
          className={
            stashStatus.state === "error"
              ? "rl-stash-status rl-stash-status--error"
              : "rl-stash-status"
          }
        >
          {stashLabel}
        </span>
        <button type="button" className="rl-text-button" onClick={onCopy}>
          <Copy size={14} />
          复制
        </button>
      </div>
    </section>
  );
}

function EditorField({
  index,
  label,
  hint,
  value,
  onChange,
  rows,
}: {
  index: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <div className="rl-editor-field">
      <div className="rl-editor-label">
        <span>{index}</span>
        <div>
          <strong>{label}</strong>
          {hint && <small>{hint}</small>}
        </div>
      </div>
      <textarea
        className="rl-editor-textarea"
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Confirmation boards (customer-facing read-only projections).
 * ------------------------------------------------------------------------- */

export type ResponseLogicConfirmationBoardProps = {
  preview: boolean;
  workspaceState?: ResponseLogicWorkspaceState;
  initialQuestionId?: string | null;
  questionGroups?: IntentQuestionGroup[];
  previewPublished?: boolean;
  onOpenAgent?: (questionId: string) => void;
};

export function ResponseLogicConfirmationBoard(
  props: ResponseLogicConfirmationBoardProps,
) {
  if (props.preview) {
    return (
      <DevelopmentResponseLogicConfirmationBoard {...props} />
    );
  }
  return <PersistentResponseLogicConfirmationBoard {...props} />;
}

export function ResponseLogicReadOnlyConfirmationBoard({
  questionGroups,
  records,
}: {
  questionGroups: IntentQuestionGroup[];
  records: ResponseLogicRecordDto[];
}) {
  return (
    <ResponseLogicConfirmationBoardContent
      preview={false}
      questionGroups={questionGroups}
      records={records}
      loading={false}
      error=""
      onRetry={() => undefined}
    />
  );
}

function DevelopmentResponseLogicConfirmationBoard(
  props: ResponseLogicConfirmationBoardProps,
) {
  const previewAdapter = useResponseLogicPreviewAdapter(true);
  if (!previewAdapter) {
    return (
      <ResponseLogicConfirmationState
        title="正在载入开发预览"
        description="正在读取本地匿名验收数据。"
        loading
      />
    );
  }
  return (
    <ResponseLogicConfirmationBoardContent
      {...props}
      previewAdapter={previewAdapter}
      records={[]}
      loading={false}
      error=""
      onRetry={() => undefined}
    />
  );
}

function PersistentResponseLogicConfirmationBoard(
  props: ResponseLogicConfirmationBoardProps,
) {
  const recordsQuery = trpc.workspace.responseLogic.useQuery(undefined, {
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  return (
    <ResponseLogicConfirmationBoardContent
      {...props}
      records={recordsQuery.data?.records ?? []}
      loading={recordsQuery.isLoading}
      error={
        recordsQuery.isError && !recordsQuery.data
          ? recordsQuery.error?.message || "应答逻辑成果载入失败"
          : ""
      }
      onRetry={() => {
        void recordsQuery.refetch();
      }}
    />
  );
}

function QuestionNavigator({
  groups,
  confirmedQuestionIds,
  selectedGroupId,
  selectedQuestionId,
  onSelectGroup,
  onSelectQuestion,
  navTitle = "待优化问题",
}: {
  groups: IntentQuestionGroup[];
  confirmedQuestionIds: Set<string>;
  selectedGroupId: string;
  selectedQuestionId: string;
  onSelectGroup: (group: IntentQuestionGroup) => void;
  onSelectQuestion: (id: string) => void;
  navTitle?: string;
}) {
  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0];
  if (!selectedGroup) return null;
  const selectedTone = semanticGroupTone(selectedGroup);
  const selectedCategory = semanticGroupCategory(selectedGroup);

  return (
    <aside
      className="rl-question-nav"
      aria-label={navTitle}
      data-tone={selectedTone}
      data-category={selectedCategory || undefined}
    >
      <div className="rl-question-nav-head">
        <div>
          <strong>{navTitle}</strong>
        </div>
        <Sparkles size={18} />
      </div>

      <div className="rl-group-tabs">
        {groups.map((group) => {
          const tone = semanticGroupTone(group);
          const category = semanticGroupCategory(group);
          const Icon = groupIcon(tone);
          return (
            <button
              key={group.id}
              type="button"
              aria-label={group.title}
              data-tone={tone}
              data-category={category || undefined}
              className={group.id === selectedGroup.id ? "active" : ""}
              onClick={() => onSelectGroup(group)}
            >
              <span className="rl-group-tab-icon">
                <Icon size={15} />
              </span>
              <span>
                <strong>{group.title}</strong>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rl-question-list">
        <div className="rl-question-list-title">
          <span>{selectedGroup.title}</span>
          <small>{selectedGroup.subtitle}</small>
        </div>
        {selectedGroup.questions.map((question, index) => (
          <button
            key={question.id}
            type="button"
            className={question.id === selectedQuestionId ? "active" : ""}
            onClick={() => onSelectQuestion(question.id)}
          >
            <span className="rl-question-index">
              {question.id === selectedQuestionId ? (
                <CircleDot size={14} />
              ) : confirmedQuestionIds.has(question.id) ? (
                <Check size={14} />
              ) : (
                String(index + 1).padStart(2, "0")
              )}
            </span>
            <span>{question.question}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ResponseLogicConfirmationBoardContent({
  workspaceState,
  initialQuestionId,
  questionGroups,
  preview,
  previewPublished,
  onOpenAgent,
  records,
  loading,
  error,
  onRetry,
  previewAdapter,
}: ResponseLogicConfirmationBoardProps & {
  records: ResponseLogicRecordDto[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  previewAdapter?: ResponseLogicPreviewAdapter;
}) {
  const groups = questionGroups ?? EMPTY_QUESTION_GROUPS;
  const entries = useMemo(
    () =>
      groups.flatMap((group) =>
        group.questions.map((question) => ({ group, question })),
      ),
    [groups],
  );
  const recordByQuestionId = useMemo(
    () => new Map(records.map((record) => [record.questionId, record])),
    [records],
  );
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    () =>
      initialQuestionId ??
      records.find((record) => record.confirmed)?.questionId ??
      entries.find(({ question }) =>
        recordByQuestionId.get(question.id)?.confirmed,
      )?.question.id ??
      entries[0]?.question.id ??
      "",
  );
  const selected =
    entries.find(({ question }) => question.id === selectedQuestionId) ??
    entries[0];
  void workspaceState;
  if (loading && records.length === 0) {
    return (
      <ResponseLogicConfirmationState
        title="正在载入问题优化成果"
        description="正在同步应答逻辑智能体已确认的正式内容。"
        loading
      />
    );
  }
  if (error) {
    return (
      <ResponseLogicConfirmationState
        title="问题优化成果载入失败"
        description={error}
        actionLabel="重新载入"
        onAction={onRetry}
      />
    );
  }
  if (!selected) {
    return (
      <ResponseLogicConfirmationState
        title="当前项目尚无优化问题"
        description="在优化问题中添加问题后，这里会按问题展示应答逻辑智能体确认的正式内容。"
      />
    );
  }
  const previewLogic =
    preview && previewAdapter && previewPublished
      ? previewAdapter.createPublishedConfirmation(
          selected.question,
          selected.group,
        )
      : null;
  const record = recordByQuestionId.get(selected.question.id);
  const logic =
    previewLogic ?? (record?.confirmed ? record.confirmed : null);
  const selectGroup = (group: IntentQuestionGroup) => {
    const questionId = group.questions[0]?.id;
    if (questionId) setSelectedQuestionId(questionId);
  };
  return (
    <div className="rl-layout">
      <QuestionNavigator
        groups={groups}
        confirmedQuestionIds={
          new Set(
            [...recordByQuestionId.values()]
              .filter((item) => item.confirmed)
              .map((item) => item.questionId),
          )
        }
        selectedGroupId={selected.group.id}
        selectedQuestionId={selected.question.id}
        onSelectGroup={selectGroup}
        onSelectQuestion={setSelectedQuestionId}
        navTitle="问题目录"
      />
      {logic ? (
        <ResponseLogicConfirmationPanel
          group={selected.group}
          question={selected.question}
          logic={logic}
          actionLabel={onOpenAgent ? "进入应答逻辑智能体" : undefined}
          onAction={
            onOpenAgent ? () => onOpenAgent(selected.question.id) : undefined
          }
        />
      ) : (
        <ResponseLogicConfirmationState
          title="尚未形成已确认的应答逻辑"
          description="应答逻辑智能体确认后，这里会展示正式应答内容。"
          actionLabel={onOpenAgent ? "进入应答逻辑智能体" : undefined}
          onAction={
            onOpenAgent ? () => onOpenAgent(selected.question.id) : undefined
          }
        />
      )}
    </div>
  );
}

export function ResponseLogicConfirmationPanel({
  group,
  question,
  logic,
  showPublicationMeta = true,
  actionLabel,
  onAction,
}: {
  group: IntentQuestionGroup;
  question: IntentQuestion;
  logic: ConfirmedLogic;
  showPublicationMeta?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tone = semanticGroupTone(group);
  const category = semanticGroupCategory(group);
  const Icon = groupIcon(tone);
  const publicLogic = normalizeResponseLogicPublicProvenance(logic);
  const sourceFiles = (publicLogic.attachments ?? []).filter(
    (attachment) =>
      attachment.kind === "file" ||
      isResponseLogicAttachmentExpired(attachment),
  );
  const uploadedImageAttachments = new Map<string, ResponseLogicAttachment>(
    (publicLogic.attachments ?? [])
      .filter((attachment) => attachment.kind === "image")
      .map(
        (attachment) =>
          [`response-logic-upload-${attachment.fileId}`, attachment] as const,
      ),
  );
  const hasSupportingAssets =
    sourceFiles.length > 0 || (publicLogic.images ?? []).length > 0;
  const versionLabel =
    publicLogic.version > 0 ? `V${publicLogic.version}.0` : "V0.1";

  return (
    <article className="rl-confirmation">
      <header
        className="rl-confirmation-head"
        data-tone={tone}
        data-category={category || undefined}
      >
        <div className="rl-confirmation-heading">
          <span className="rl-context-icon">
            <Icon size={21} />
          </span>
          <div>
            <span>
              {group.title} · {group.subtitle}
            </span>
            <h3>{question.question}</h3>
          </div>
        </div>
        {(showPublicationMeta || (actionLabel && onAction)) && (
          <div className="rl-confirmation-meta">
            {showPublicationMeta && (
              <>
                <span>已发布应答逻辑 {versionLabel}</span>
                <span>
                  发布时间：{formatConfirmedAt(publicLogic.updatedAt)}
                </span>
              </>
            )}
            {actionLabel && onAction && (
              <button
                type="button"
                className="rl-confirmation-action"
                onClick={onAction}
              >
                {actionLabel}
              </button>
            )}
          </div>
        )}
      </header>

      <section
        className="rl-answer-hero"
        data-tone={tone}
        data-category={category || undefined}
      >
        <div className="rl-answer-visual">
          <span>
            <Sparkles size={22} />
          </span>
          <small>应答逻辑</small>
          <strong>{group.title}</strong>
          <p>问题 · 证据 · 口径 · 边界</p>
        </div>
        <div className="rl-answer-summary">
          <span>用户真实关心</span>
          <p className="rl-confirmation-concern">{publicLogic.concern}</p>
        </div>
      </section>

      <div className="rl-confirmation-grid">
        <LogicSection
          number="01"
          title="核心结论与执行口径"
          content={publicLogic.conclusion}
          wide
        />
        <LogicSection
          number="02"
          title={RESPONSE_LOGIC_FACTS_DISPLAY_HEADING}
          content={publicLogic.facts}
        />
        <LogicSection
          number="03"
          title="回答边界/禁止表达"
          content={publicLogic.boundaries}
          variant="boundary"
        />
        {hasSupportingAssets && (
          <section className="rl-logic-section rl-reference-section wide">
            <div className="rl-logic-section-title">
              <span>04</span>
              <div>
                <h4>图文依据</h4>
                <p>材料与图片都归属于当前问题，不拆分为独立图片库。</p>
              </div>
            </div>
            <div className="rl-reference-content">
              <div className="rl-reference-list">
                {sourceFiles.map((attachment) => (
                  <div key={attachment.fileId} className="rl-reference-file">
                    <Paperclip size={15} />
                    <FilePreview
                      file={{
                        ...responseLogicChatAttachment(attachment),
                        name: "用户上传资料",
                      }}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
              {(publicLogic.images ?? []).length > 0 && (
                <div className="rl-confirmed-images">
                  {(publicLogic.images ?? []).map((image) => {
                    const uploadedAttachment = uploadedImageAttachments.get(
                      image.id,
                    );
                    return (
                      <figure key={image.id}>
                        {uploadedAttachment ? (
                          <ImagePreview
                            fileId={uploadedAttachment.fileId}
                            alt="用户上传图片"
                            expiresAt={uploadedAttachment.expiresAt}
                            expired={uploadedAttachment.expired}
                            className="rl-owned-image-preview-confirmed"
                          />
                        ) : (
                          <img
                            src={image.url}
                            alt={image.caption || image.name}
                          />
                        )}
                        <figcaption>
                          <strong>
                            {uploadedAttachment
                              ? "用户上传图片"
                              : normalizeResponseLogicPublicText(
                                  image.caption || image.name,
                                ) || "应答逻辑配图"}
                          </strong>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

function LogicSection({
  number,
  title,
  content,
  wide = false,
  variant = "default",
}: {
  number: string;
  title: string;
  content: string;
  wide?: boolean;
  variant?: "default" | "boundary";
}) {
  return (
    <section
      className={
        variant === "boundary"
          ? "rl-logic-section rl-logic-section--boundary"
          : "rl-logic-section"
      }
      data-wide={wide || undefined}
    >
      <div className="rl-logic-section-title">
        <span>{number}</span>
        <div>
          <h4>{title}</h4>
        </div>
      </div>
      <div className="rl-logic-section-content">
        {content.split("\n").map((line, index) => (
          <p key={index}>{line || "\u00A0"}</p>
        ))}
      </div>
    </section>
  );
}
