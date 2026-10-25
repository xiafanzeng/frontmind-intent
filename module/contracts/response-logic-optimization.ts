import { z } from "zod";
import type { LogicSections } from "./response-logic-evaluation.js";

/**
 * Wire contract for the LLM optimization of one response-logic draft.
 *
 * The optimizer consumes the Judge's four-dimension diagnosis (findings and
 * suggestions) and produces an improved CANDIDATE draft — never scores, never
 * an aggregate, and never a write into the live record. It reuses the Judge's
 * evidence vocabulary: every cited excerpt must be a contiguous substring of
 * either the evaluated draft ("draft") or the provided knowledge materials
 * ("knowledge"). A change REASON is an explanation, not evidence — evidence
 * must come from the explicit evidence array of each change.
 *
 * The structured output arrives as a JSON string inside the `payload` field
 * of the v2 structured output envelope (same pattern as the judge).
 */

export const OPTIMIZATION_LOGIC_FIELD_SCHEMA = z.enum([
  "concern",
  "conclusion",
  "facts",
  "boundaries",
]);
export type OptimizationLogicField = z.infer<typeof OPTIMIZATION_LOGIC_FIELD_SCHEMA>;

/** Evidence excerpt supporting a change; source defines where it must verify. */
export const optimizationEvidenceSchema = z
  .object({
    source: z.enum(["draft", "knowledge"]),
    excerpt: z.string().min(1),
    supports: z.string().min(1),
  })
  .strict();
export type OptimizationEvidence = z.infer<typeof optimizationEvidenceSchema>;

/** One key modification: which field, why, and the verifiable evidence for it. */
export const optimizationChangeSchema = z
  .object({
    field: OPTIMIZATION_LOGIC_FIELD_SCHEMA,
    summary: z.string().min(1),
    evidence: z.array(optimizationEvidenceSchema),
  })
  .strict();
export type OptimizationChange = z.infer<typeof optimizationChangeSchema>;

export const optimizationOutputSchema = z
  .object({
    kind: z.literal("judge-optimization"),
    summary: z.string().min(1),
    optimizedDraft: z
      .object({
        concern: z.string(),
        conclusion: z.string(),
        facts: z.string(),
        boundaries: z.string(),
      })
      .strict(),
    changes: z.array(optimizationChangeSchema).min(1),
  })
  .strict();
export type OptimizationOutput = z.infer<typeof optimizationOutputSchema>;

/** Envelope returned by the optimization status endpoint once completed. */
export const optimizationEnvelopeSchema = z
  .object({
    status: z.literal("completed"),
    optimizerVersion: z.string(),
    recordRevision: z.number().int().nonnegative(),
    sourceFingerprint: z.string(),
    judgeTaskId: z.string(),
    knowledgeFingerprint: z.string(),
    evaluatedAt: z.string(),
    optimization: optimizationOutputSchema,
  })
  .strict();
export type OptimizationEnvelope = z.infer<typeof optimizationEnvelopeSchema>;

/* ---------------------------------------------------------------------------
 * Verification helpers (server-side, complement the Zod schema)
 * ------------------------------------------------------------------------- */

export function verifyOptimizationEvidence(
  optimization: OptimizationOutput,
  logic: LogicSections,
  knowledgeContent: string | null,
): { valid: number; invalid: number; invalidDraft: number; invalidKnowledge: number; invalidExcerpts: string[] } {
  const draftFields: Record<string, string> = {
    concern: logic.concern,
    conclusion: logic.conclusion,
    facts: logic.facts,
    boundaries: logic.boundaries,
  };
  let valid = 0;
  let invalid = 0;
  let invalidDraft = 0;
  let invalidKnowledge = 0;
  const invalidExcerpts: string[] = [];
  const check = (evidence: { source: string; excerpt: string }) => {
    if (evidence.source === "draft") {
      if (Object.values(draftFields).some((text) => text.includes(evidence.excerpt))) valid++;
      else {
        invalid++;
        invalidDraft++;
        invalidExcerpts.push(evidence.excerpt.slice(0, 50));
      }
      return;
    }
    // knowledge-sourced evidence must exist in the actual knowledge materials;
    // when no knowledge is available ANY knowledge citation is a fabrication.
    if (knowledgeContent !== null && knowledgeContent.includes(evidence.excerpt)) valid++;
    else {
      invalid++;
      invalidKnowledge++;
      invalidExcerpts.push(evidence.excerpt.slice(0, 50));
    }
  };
  for (const change of optimization.changes) {
    for (const evidence of change.evidence) check(evidence);
  }
  return { valid, invalid, invalidDraft, invalidKnowledge, invalidExcerpts };
}

/** The optimized draft must be a complete four-section structure. */
export function verifyOptimizedDraftStructure(
  optimization: OptimizationOutput,
): { ok: true } | { ok: false; reason: string } {
  const draft = optimization.optimizedDraft;
  for (const field of ["concern", "conclusion", "facts", "boundaries"] as const) {
    if (typeof draft[field] !== "string") {
      return { ok: false, reason: `optimizedDraft.${field} 缺失或类型错误` };
    }
  }
  if (optimization.changes.some((change) => change.summary.trim().length === 0)) {
    return { ok: false, reason: "存在空的修改说明" };
  }
  return { ok: true };
}
