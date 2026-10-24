import { z } from "zod";

/**
 * Wire contract for the LLM-as-Judge evaluation of one response-logic draft.
 *
 * The Judge is a semantic quality assessment layered on top of the
 * deterministic rule evaluation (contracts/response-logic-evaluation.ts).
 * It shares the same four dimensions and score ranges but produces
 * independently reasoned findings with evidence attribution and confidence.
 *
 * The structured output from the model arrives as a JSON string inside the
 * `payload` field of the v2 structured output envelope (same pattern as
 * brand-question-portfolio). The server parses and validates it with
 * `judgeOutputSchema` before accepting the result.
 *
 * Design boundary: this contract does NOT modify, extend or alias the rule
 * evaluation schema. The two coexist independently; the Judge result is
 * never written into the rule evaluation structure.
 */

/* ---------------------------------------------------------------------------
 * Shared enums
 * ------------------------------------------------------------------------- */

export const JUDGE_SEVERITY_SCHEMA = z.enum(["info", "improve", "risk"]);
export type JudgeSeverity = z.infer<typeof JUDGE_SEVERITY_SCHEMA>;

export const JUDGE_EVIDENCE_SOURCE_SCHEMA = z.enum(["draft", "knowledge", "inference"]);
export type JudgeEvidenceSource = z.infer<typeof JUDGE_EVIDENCE_SOURCE_SCHEMA>;

export const JUDGE_EVIDENCE_CONFIDENCE_SCHEMA = z.enum(["supported", "partial", "unverifiable"]);
export type JudgeEvidenceConfidence = z.infer<typeof JUDGE_EVIDENCE_CONFIDENCE_SCHEMA>;

export const JUDGE_RELEVANCE_BAND_SCHEMA = z.enum([
  "direct",
  "mostly_relevant",
  "partially_responsive",
  "background_dominant",
  "off_topic",
]);
export type JudgeRelevanceBand = z.infer<typeof JUDGE_RELEVANCE_BAND_SCHEMA>;

export const JUDGE_ACTIONABILITY_BAND_SCHEMA = z.enum([
  "highly_actionable",
  "mostly_actionable",
  "moderately_actionable",
  "vague",
  "not_actionable",
]);
export type JudgeActionabilityBand = z.infer<typeof JUDGE_ACTIONABILITY_BAND_SCHEMA>;

export const JUDGE_COVERAGE_FIELD_SCHEMA = z.enum(["concern", "conclusion", "facts", "boundaries"]);
export type JudgeCoverageField = z.infer<typeof JUDGE_COVERAGE_FIELD_SCHEMA>;

export const JUDGE_COVERAGE_STATUS_SCHEMA = z.enum(["covered", "partial", "missing"]);
export type JudgeCoverageStatus = z.infer<typeof JUDGE_COVERAGE_STATUS_SCHEMA>;

export const JUDGE_SUB_METRIC_KEY_SCHEMA = z.enum([
  "content_specificity",
  "evidence_guidance",
  "structure_guidance",
]);
export type JudgeSubMetricKey = z.infer<typeof JUDGE_SUB_METRIC_KEY_SCHEMA>;

export const JUDGE_RISK_KEY_SCHEMA = z.enum([
  "unverified_ranking",
  "absolute_claim",
  "effect_promise",
  "unverified_comparison",
  "unsupported_fact",
  "missing_precondition",
]);
export type JudgeRiskKey = z.infer<typeof JUDGE_RISK_KEY_SCHEMA>;

export const JUDGE_RISK_STATUS_SCHEMA = z.enum([
  "controlled",
  "partial",
  "uncontrolled",
  "undetected",
  "not_applicable",
  "indeterminate",
]);
export type JudgeRiskStatus = z.infer<typeof JUDGE_RISK_STATUS_SCHEMA>;

/* ---------------------------------------------------------------------------
 * Finding structure (used inside every dimension)
 * ------------------------------------------------------------------------- */

export const judgeFindingSchema = z
  .object({
    severity: JUDGE_SEVERITY_SCHEMA,
    evidence: z.string(),
    evidenceSource: JUDGE_EVIDENCE_SOURCE_SCHEMA,
    evidenceConfidence: JUDGE_EVIDENCE_CONFIDENCE_SCHEMA,
    reason: z.string().min(1),
    suggestion: z.string().min(1),
  })
  .strict();
export type JudgeFinding = z.infer<typeof judgeFindingSchema>;

/* ---------------------------------------------------------------------------
 * Dimension: relevance
 * ------------------------------------------------------------------------- */

export const judgeRelevanceSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    band: JUDGE_RELEVANCE_BAND_SCHEMA,
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeRelevance = z.infer<typeof judgeRelevanceSchema>;

/* ---------------------------------------------------------------------------
 * Dimension: completeness
 * ------------------------------------------------------------------------- */

export const judgeCoverageItemSchema = z
  .object({
    field: JUDGE_COVERAGE_FIELD_SCHEMA,
    status: JUDGE_COVERAGE_STATUS_SCHEMA,
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeCoverageItem = z.infer<typeof judgeCoverageItemSchema>;

export const judgeCompletenessSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    coverage: z.array(judgeCoverageItemSchema).length(4),
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeCompleteness = z.infer<typeof judgeCompletenessSchema>;

/* ---------------------------------------------------------------------------
 * Dimension: actionability
 * ------------------------------------------------------------------------- */

export const judgeSubMetricSchema = z
  .object({
    key: JUDGE_SUB_METRIC_KEY_SCHEMA,
    score: z.number().int().min(0).max(100),
    band: JUDGE_ACTIONABILITY_BAND_SCHEMA,
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeSubMetric = z.infer<typeof judgeSubMetricSchema>;

export const judgeActionabilitySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    subMetrics: z.array(judgeSubMetricSchema).length(3),
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeActionability = z.infer<typeof judgeActionabilitySchema>;

/* ---------------------------------------------------------------------------
 * Dimension: boundaryRisk
 * ------------------------------------------------------------------------- */

export const judgeRiskItemSchema = z
  .object({
    key: JUDGE_RISK_KEY_SCHEMA,
    status: JUDGE_RISK_STATUS_SCHEMA,
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeRiskItem = z.infer<typeof judgeRiskItemSchema>;

export const judgeBoundaryRiskSchema = z
  .object({
    score: z.number().int().min(0).max(100).nullable(),
    risks: z.array(judgeRiskItemSchema).length(6),
    findings: z.array(judgeFindingSchema),
  })
  .strict();
export type JudgeBoundaryRisk = z.infer<typeof judgeBoundaryRiskSchema>;

/* ---------------------------------------------------------------------------
 * Top-level output
 * ------------------------------------------------------------------------- */

export const judgeOutputSchema = z
  .object({
    kind: z.literal("judge-evaluation"),
    dimensions: z
      .object({
        relevance: judgeRelevanceSchema,
        completeness: judgeCompletenessSchema,
        actionability: judgeActionabilitySchema,
        boundaryRisk: judgeBoundaryRiskSchema,
      })
      .strict(),
    overallAssessment: z.string().min(1),
  })
  .strict();
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/* ---------------------------------------------------------------------------
 * Envelope (what the API returns to the caller)
 * ------------------------------------------------------------------------- */

export const judgeEvaluationEnvelopeSchema = z
  .object({
    status: z.literal("completed"),
    judgeVersion: z.string(),
    recordRevision: z.number().int().nonnegative(),
    sourceFingerprint: z.string(),
    evaluatedAt: z.string(),
    judge: judgeOutputSchema,
  })
  .strict();
export type JudgeEvaluationEnvelope = z.infer<typeof judgeEvaluationEnvelopeSchema>;

/* ---------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------- */

/**
 * Verify that a `draft` evidence excerpt is a contiguous substring of the
 * corresponding draft field. Returns the field name if found, null otherwise.
 * This is a semantic check that complements (not replaces) the Zod schema.
 */
export function verifyDraftExcerpt(
  judge: JudgeOutput,
  logic: { concern: string; conclusion: string; facts: string; boundaries: string },
): { valid: number; invalid: number; invalidExcerpts: string[] } {
  const fields: Record<string, string> = {
    concern: logic.concern,
    conclusion: logic.conclusion,
    facts: logic.facts,
    boundaries: logic.boundaries,
  };
  let valid = 0;
  let invalid = 0;
  const invalidExcerpts: string[] = [];

  const checkFindings = (findings: JudgeFinding[]) => {
    for (const f of findings) {
      if (f.evidenceSource === "draft" && f.evidence) {
        const found = Object.values(fields).some((text) => text.includes(f.evidence));
        if (found) valid++;
        else {
          invalid++;
          invalidExcerpts.push(f.evidence.slice(0, 50));
        }
      }
    }
  };

  checkFindings(judge.dimensions.relevance.findings);
  for (const c of judge.dimensions.completeness.coverage) checkFindings(c.findings);
  checkFindings(judge.dimensions.completeness.findings);
  for (const s of judge.dimensions.actionability.subMetrics) checkFindings(s.findings);
  checkFindings(judge.dimensions.actionability.findings);
  for (const r of judge.dimensions.boundaryRisk.risks) checkFindings(r.findings);
  checkFindings(judge.dimensions.boundaryRisk.findings);

  return { valid, invalid, invalidExcerpts };
}

/**
 * Recompute the completeness score from coverage statuses and verify it
 * matches the model's declared score. Returns null if consistent.
 */
export function recomputeCompletenessScore(judge: JudgeOutput): number | null {
  const coverage = judge.dimensions.completeness.coverage;
  if (coverage.length !== 4) return null;
  const expected = Math.round(
    coverage.reduce((sum, item) => sum + (item.status === "covered" ? 100 : item.status === "partial" ? 50 : 0), 0) / 4,
  );
  return judge.dimensions.completeness.score === expected ? null : expected;
}

/**
 * Recompute the actionability score from sub-metric scores and verify it
 * matches the model's declared score. Returns null if consistent.
 */
export function recomputeActionabilityScore(judge: JudgeOutput): number | null {
  const subs = judge.dimensions.actionability.subMetrics;
  if (subs.length !== 3) return null;
  const expected = Math.round(subs.reduce((sum, s) => sum + s.score, 0) / 3);
  return judge.dimensions.actionability.score === expected ? null : expected;
}

/**
 * Recompute the boundaryRisk score from risk statuses and verify it matches.
 * Returns null if consistent (including the null-score case).
 */
export function recomputeBoundaryRiskScore(judge: JudgeOutput): number | null {
  const risks = judge.dimensions.boundaryRisk.risks;
  if (risks.length !== 6) return null;
  const scored = risks.filter(
    (r) => r.status === "controlled" || r.status === "partial" || r.status === "uncontrolled",
  );
  const expected = scored.length
    ? Math.round(
        scored.reduce((sum, r) => sum + (r.status === "controlled" ? 100 : r.status === "partial" ? 50 : 0), 0) / scored.length,
      )
    : null;
  return judge.dimensions.boundaryRisk.score === expected ? null : expected;
}
