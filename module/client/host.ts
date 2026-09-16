import type { ComponentType, ReactNode } from "react";
import type {
  ConfirmedResponseLogic,
  ResponseLogicAttachment,
  ResponseLogicDraft,
  ResponseLogicRecordDto,
  SaveResponseLogicInput,
} from "../contracts/response-logic.js";
import type { GeneralExecutionDto } from "@frontmind/module-contracts/execution";

/** Host-owned REST operation. The module never chooses auth, project headers, or a server origin. */
export interface IntentRestOperation {
  readonly signal: AbortSignal;
  assertActive(): void;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
export type CaptureIntentRestOperation = (
  signal?: AbortSignal | null,
  explicitScope?: { enterpriseProjectId?: string; projectAssignmentId?: string },
  options?: { detached?: boolean },
) => IntentRestOperation;

export interface IntentMessageContent {
  type: "input_text" | "input_image" | "input_file";
  text?: string; image_url?: string; file_id?: string; filename?: string; mime_type?: string;
}
export interface IntentMessage { role: "user" | "assistant" | "system"; content: IntentMessageContent[] | string; }
export interface StartResponseLogicTaskInput {
  questionId: string; groupId: string; groupTitle: string; question: string; intent: string; summary: string;
  draft: ResponseLogicDraft; operationRevision?: number; conversationId: string; taskId?: string;
}
export interface StartResponseLogicTaskResult { id: string; operationRevision?: number; execution?: GeneralExecutionDto; }
export type StartResponseLogicTask = (messages: IntentMessage[], input: StartResponseLogicTaskInput, signal?: AbortSignal) => Promise<StartResponseLogicTaskResult>;
export interface UploadedIntentAsset { fileId: string; filename: string; sizeBytes?: number; expiresAt: number; }
export type UploadIntentAsset = (file: File, onProgress?: (percent: number) => void, options?: { filename?: string; mimeType?: string; signal?: AbortSignal }) => Promise<UploadedIntentAsset>;

export interface IntentButtonProps { children?: ReactNode; className?: string; disabled?: boolean; type?: "button" | "submit" | "reset"; variant?: "default" | "operator" | "operatorOutline" | "destructive" | "outline" | "secondary" | "ghost" | "link"; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; }
export interface IntentFilePreviewProps { file: { id: string; type: "image" | "file"; name: string; fileId: string }; className?: string; showDownload?: boolean; }
export interface IntentImagePreviewProps { src?: string; fileId?: string; alt?: string; className?: string; showDownload?: boolean; expiresAt?: number; expired?: boolean; }
export interface IntentExecutionProps { execution: GeneralExecutionDto; }

export interface IntentVisualComponents {
  BusinessExecutionActivity: ComponentType<IntentExecutionProps>;
  FilePreview: ComponentType<IntentFilePreviewProps>;
  ImagePreview: ComponentType<IntentImagePreviewProps>;
  Button: ComponentType<IntentButtonProps>;
}
export interface IntentToast { success(message: string): void; error(message: string): void; }
export interface IntentCategoryAdapter { categoryKey(value: string): string | null | undefined; categoryTone(value: string): "plum" | "teal" | "amber" | "blue" | null | undefined; }

export interface ResponseLogicQueryResult { isLoading: boolean; isFetching: boolean; isSuccess: boolean; isError: boolean; data?: { records: ResponseLogicRecordDto[] }; error?: { message?: string } | null; refetch(): Promise<{ data?: { records: ResponseLogicRecordDto[] }; error?: unknown }>; }
export interface ResponseLogicMutation { mutateAsync(input: SaveResponseLogicInput): Promise<{ record: ResponseLogicRecordDto }>; }
export interface ResponseLogicCache { setData(input: undefined, updater: (current: { records: ResponseLogicRecordDto[] } | undefined) => { records: ResponseLogicRecordDto[] } | undefined): void; }
export interface IntentTrpcHost { useUtils(): { workspace: { responseLogic: ResponseLogicCache } }; workspace: { responseLogic: { useQuery(input: undefined, options: { retry: boolean; refetchOnMount: "always" | boolean; refetchOnWindowFocus: boolean; refetchInterval: number; refetchIntervalInBackground: boolean }): ResponseLogicQueryResult }; saveResponseLogic: { useMutation(options: { onSuccess: (value: { record: ResponseLogicRecordDto }) => void }): ResponseLogicMutation } } }

/** All browser/application dependencies needed by the visual shell are injected by the main workbench. */
export interface IntentWorkspaceHost extends IntentVisualComponents, IntentCategoryAdapter {
  captureRestOperation: CaptureIntentRestOperation;
  useSearch(): string;
  activeEnterpriseProjectId(): string | undefined;
  trpc: IntentTrpcHost;
  createResponseLogicTask: StartResponseLogicTask;
  uploadChatLocalAsset: UploadIntentAsset;
  toast: IntentToast;
  loadPreviewAdapter?(): Promise<import("./ResponseLogicWorkspace.js").ResponseLogicPreviewAdapter>;
}

// Keep these aliases available to a host adapter without importing private Dashboard contracts.
export type { ConfirmedResponseLogic, ResponseLogicAttachment, ResponseLogicDraft, ResponseLogicRecordDto, SaveResponseLogicInput };
