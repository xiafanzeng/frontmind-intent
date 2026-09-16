import { describe, expect, it } from "vitest";
import { mergeResponseLogicAttachmentsIntoDraft, reconcileResponseLogicDrafts } from "./response-logic-workspace.js";
import type { ResponseLogicDraft, ResponseLogicRecordDto } from "../contracts/response-logic.js";

const base: ResponseLogicDraft = { concern: "c", conclusion: "a", facts: "f", pending: "", boundaries: "b", references: "", attachments: [], images: [] };
const record = (draft: ResponseLogicDraft): ResponseLogicRecordDto => ({
  id: "r1", questionId: "q1", groupId: "g1", groupTitle: "Group", question: "Question", intent: "Intent", summary: "Summary",
  revision: 1, version: 0, createdAt: 1, updatedAt: 1, draft,
});

describe("standalone response logic draft state", () => {
  it("preserves locally edited text while adopting authoritative reset/removal", () => {
    const local = { ...base, facts: "An unsaved local edit" };
    const result = reconcileResponseLogicDrafts({ q1: local, q2: base }, [record(base)], new Set(["q1", "q2"]));
    expect(result.drafts.q1).toBe(local);
    expect(result.removedQuestionIds).toEqual(["q2"]);
    expect(result.drafts.q2).toBeUndefined();
  });
  it("uses the authoritative record when editable content is unchanged", () => {
    const server = { ...base };
    const result = reconcileResponseLogicDrafts({ q1: { ...base } }, [record(server)], new Set(["q1"]));
    expect(result.drafts.q1).toBe(server);
  });
  it("removes expired upload images while retaining their attachment record", () => {
    const attachment = { fileId: "file-1", filename: "logo.png", mimeType: "image/png", kind: "image" as const, uploadedAt: "2026-01-01T00:00:00.000Z" };
    const withImage = mergeResponseLogicAttachmentsIntoDraft(base, [attachment]);
    expect(withImage.images).toHaveLength(1);
    const expired = mergeResponseLogicAttachmentsIntoDraft(withImage, [{ ...attachment, expired: true }]);
    expect(expired.images).toHaveLength(0);
    expect(expired.attachments).toHaveLength(1);
  });
});
