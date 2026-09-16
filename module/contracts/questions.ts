import { z } from "zod";

export const workspaceQuestionCategorySchema = z.enum([
  "industry",
  "competitor_comparison",
  "reputation",
  "product_scenario",
]);
export type WorkspaceQuestionCategory = z.infer<
  typeof workspaceQuestionCategorySchema
>;

export const servicePortalQuestionSchema = z.object({
  id: z.string(),
  contractId: z.string().nullable(),
  quotaPeriodId: z.string(),
  externalQuestionId: z.string().nullable(),
  sourceQuestionId: z.string().nullable(),
  // User-authored questions remain unclassified until a delivery engineer
  // approves them. Selected questions must always have a concrete category;
  // that invariant is enforced by the selection service.
  category: workspaceQuestionCategorySchema.nullable(),
  question: z.string(),
  intent: z.string().nullable(),
  intentRevision: z.number().int().positive(),
  intentConfirmedRevision: z.number().int().positive().nullable(),
  intentConfirmedAt: z.number().int().nonnegative().nullable(),
  intentConfirmed: z.boolean(),
  responseLogicConfirmed: z.boolean().optional(),
  rationale: z.string().nullable(),
  evidence: z.array(
    z.object({
      documentPath: z.string(),
      excerpt: z.string(),
      relevance: z.string(),
    }),
  ),
  risks: z.array(z.string()),
  source: z.enum(["model", "website", "offline", "admin", "user"]),
  status: z.enum(["candidate", "selected", "archived"]),
  selectionApprovalStatus: z.enum(["not_requested", "pending", "approved"]),
  selectionRequestedAt: z.number().int().nonnegative().nullable(),
  selectionApprovedAt: z.number().int().nonnegative().nullable(),
  locked: z.boolean(),
  revision: z.number().int().positive(),
});
export type ServicePortalQuestion = z.infer<typeof servicePortalQuestionSchema>;

export const selectedServicePortalQuestionSchema =
  servicePortalQuestionSchema.extend({
    category: workspaceQuestionCategorySchema,
  });
export type SelectedServicePortalQuestion = z.infer<
  typeof selectedServicePortalQuestionSchema
>;

/** Browser question data excludes commercial contract coordinates. */
export type PublicServicePortalQuestion = Omit<ServicePortalQuestion, "contractId" | "quotaPeriodId">;
