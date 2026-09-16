import { parseResponseLogicStructuredDraft, type ResponseLogicAttachment, type ResponseLogicDraft, type ResponseLogicImage, type ResponseLogicRecordDto } from "../contracts/response-logic.js";

export function parseResponseLogicReply(
  reply: string,
): Pick<LogicDraft, LogicTextField> {
  return {
    ...parseResponseLogicStructuredDraft(reply),
    pending: "",
    references: "",
  };
}

export function getResponseLogicPollDelay(
  elapsedMs: number,
  consecutiveFailures = 0,
) {
  const steady = elapsedMs < 5 * 60_000 ? 3_000 : 10_000;
  return Math.min(30_000, steady * 2 ** Math.min(consecutiveFailures, 3));
}

export function isResponseLogicAttachmentExpired(
  attachment: Pick<ResponseLogicAttachment, "expired" | "expiresAt">,
  now = Date.now(),
) {
  return (
    attachment.expired === true ||
    (typeof attachment.expiresAt === "number" &&
      attachment.expiresAt <= now)
  );
}

export function mergeResponseLogicAttachmentsIntoDraft(
  draft: LogicDraft,
  attachments: ResponseLogicAttachment[],
): LogicDraft {
  const mergedAttachments = new Map<string, ResponseLogicAttachment>();
  for (const attachment of [...draft.attachments, ...attachments]) {
    mergedAttachments.set(attachment.fileId, attachment);
  }
  const authoritativeAttachments = [...mergedAttachments.values()];
  const expiredUploadImageIds = new Set(
    authoritativeAttachments
      .filter(
        (attachment) =>
          attachment.kind === "image" &&
          isResponseLogicAttachmentExpired(attachment),
      )
      .map((attachment) => `response-logic-upload-${attachment.fileId}`),
  );
  const uploadedImages: LogicImage[] = authoritativeAttachments
    .filter(
      (attachment) =>
        attachment.kind === "image" &&
        !isResponseLogicAttachmentExpired(attachment),
    )
    .map((attachment) => ({
      id: `response-logic-upload-${attachment.fileId}`,
      name: attachment.filename,
      url: responseLogicAttachmentUrl(attachment.fileId),
      caption: attachment.filename.replace(/\.[^.]+$/, ""),
      source: `应答材料上传：${attachment.filename}`,
      section: "图文依据",
      authorization: "本次应答可用",
    }));

  return {
    ...draft,
    attachments: authoritativeAttachments,
    images: [
      ...draft.images.filter((image) => !expiredUploadImageIds.has(image.id)),
      ...uploadedImages.filter(
        (candidate) =>
          !draft.images.some(
            (image) => image.id === candidate.id || image.url === candidate.url,
          ),
      ),
    ],
  };
}

export function reconcileResponseLogicDrafts(
  current: Record<string, LogicDraft>,
  records: readonly ResponseLogicRecordDto[],
  previousQuestionIds: ReadonlySet<string> | null,
) {
  const next: Record<string, LogicDraft> = {};
  const removed = (previousQuestionIds ?? new Set()).size
    ? [...(previousQuestionIds ?? [])].filter(
        (questionId) => !records.some((record) => record.questionId === questionId),
      )
    : [];
  for (const record of records) {
    const local = current[record.questionId];
    next[record.questionId] =
      local && !sameDraftContent(local, record.draft)
        ? local
        : record.draft;
  }
  return { drafts: next, removedQuestionIds: removed };
}

type LogicDraft = ResponseLogicDraft;

type LogicTextField = keyof Omit<LogicDraft, "images" | "attachments">;

type LogicImage = ResponseLogicImage;

function responseLogicAttachmentUrl(fileId: string) {
  return `/api/frontmind/v1/files/${encodeURIComponent(fileId)}`;
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
