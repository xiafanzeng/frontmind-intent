import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  judgeOutputSchema,
  verifyDraftExcerpt,
  recomputeCompletenessScore,
  recomputeActionabilityScore,
  recomputeBoundaryRiskScore,
  type JudgeOutput,
} from "../contracts/response-logic-judge";
import { buildDirectorySkillArchive } from "../server/directory-skill-archive";

const logic = {
  concern: "用户关注机构资质与真实性，担心选错服务商，希望有可核验的判断标准",
  conclusion: "先核验资质与授权，再对比服务范围与成功案例，最后按适用条件收敛选择。",
  facts: "资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯",
  boundaries: "不使用绝对化承诺；排名表述必须给出样本范围与时间。",
};

const finding = (over: Partial<ReturnType<typeof baseFinding>> = {}) => ({ ...baseFinding(), ...over });
function baseFinding() {
  return {
    severity: "improve" as const,
    evidence: "先核验资质与授权",
    evidenceSource: "draft" as const,
    evidenceConfidence: "supported" as const,
    reason: "首句明确回应了选型判断标准",
    suggestion: "补充具体的资质核验清单",
  };
}

const validJudge: JudgeOutput = {
  kind: "judge-evaluation",
  dimensions: {
    relevance: {
      score: 85,
      band: "mostly_relevant",
      findings: [finding()],
    },
    completeness: {
      score: 75,
      coverage: [
        { field: "concern", status: "covered", findings: [] },
        { field: "conclusion", status: "covered", findings: [] },
        { field: "facts", status: "partial", findings: [finding()] },
        { field: "boundaries", status: "partial", findings: [] },
      ],
      findings: [],
    },
    actionability: {
      score: 67,
      subMetrics: [
        { key: "content_specificity", score: 75, band: "mostly_actionable", findings: [] },
        { key: "evidence_guidance", score: 60, band: "moderately_actionable", findings: [] },
        { key: "structure_guidance", score: 65, band: "moderately_actionable", findings: [] },
      ],
      findings: [],
    },
    boundaryRisk: {
      score: 63,
      risks: [
        { key: "unverified_ranking", status: "controlled", findings: [] },
        { key: "absolute_claim", status: "controlled", findings: [] },
        { key: "effect_promise", status: "uncontrolled", findings: [finding({ severity: "risk" })] },
        { key: "unverified_comparison", status: "undetected", findings: [] },
        { key: "unsupported_fact", status: "partial", findings: [] },
        { key: "missing_precondition", status: "not_applicable", findings: [] },
      ],
      findings: [],
    },
  },
  overallAssessment: "草稿整体回应了选型问题，但证据指引和边界控制有提升空间。",
};

describe("judge output schema", () => {
  it("accepts a valid four-dimension judge output", () => {
    const result = judgeOutputSchema.safeParse(validJudge);
    expect(result.success).toBe(true);
  });

  it("rejects a score above 100", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.relevance.score = 101;
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a negative score", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.relevance.score = -1;
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-integer score", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.relevance.score = 85.5;
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid relevance band", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.relevance as { band: string }).band = "excellent";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid actionability band", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.actionability.subMetrics[0] as { band: string }).band = "amazing";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing dimension", () => {
    const bad = structuredClone(validJudge) as Record<string, unknown>;
    const dims = bad.dimensions as Record<string, unknown>;
    delete dims.actionability;
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    const bad = { ...validJudge, overall: 85 };
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown dimension-level field", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.relevance as Record<string, unknown>).weight = 0.5;
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid evidence confidence", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.relevance.findings[0] as Record<string, unknown>).evidenceConfidence = "certain";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid evidence source", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.relevance.findings[0] as Record<string, unknown>).evidenceSource = "external";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid severity", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.relevance.findings[0] as Record<string, unknown>).severity = "critical";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects completeness with fewer than 4 coverage items", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.completeness.coverage = bad.dimensions.completeness.coverage.slice(0, 3);
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects completeness with more than 4 coverage items", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.completeness.coverage.push(
      structuredClone(bad.dimensions.completeness.coverage[0]),
    );
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid coverage field", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.completeness.coverage[0] as Record<string, unknown>).field = "references";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects actionability with fewer than 3 sub-metrics", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.actionability.subMetrics = bad.dimensions.actionability.subMetrics.slice(0, 2);
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid sub-metric key", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.actionability.subMetrics[0] as Record<string, unknown>).key = "creativity";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects boundaryRisk with fewer than 6 risks", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.boundaryRisk.risks = bad.dimensions.boundaryRisk.risks.slice(0, 5);
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid risk key", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.boundaryRisk.risks[0] as Record<string, unknown>).key = "unknown_risk";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invalid risk status", () => {
    const bad = structuredClone(validJudge);
    (bad.dimensions.boundaryRisk.risks[0] as Record<string, unknown>).status = "handled";
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a wrong kind literal", () => {
    const bad = { ...validJudge, kind: "rule-evaluation" };
    expect(judgeOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("allows boundaryRisk score to be null when nothing is scored", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.boundaryRisk.score = null;
    for (const r of bad.dimensions.boundaryRisk.risks) {
      r.status = "undetected" as typeof r.status;
    }
    expect(judgeOutputSchema.safeParse(bad).success).toBe(true);
  });
});

describe("draft excerpt verification", () => {
  it("validates a correct draft excerpt", () => {
    const result = verifyDraftExcerpt(validJudge, logic);
    expect(result.invalid).toBe(0);
    expect(result.valid).toBeGreaterThan(0);
  });

  it("flags an excerpt not present in the draft", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.relevance.findings[0].evidence = "这段文字不在草稿中";
    const result = verifyDraftExcerpt(bad, logic);
    expect(result.invalid).toBeGreaterThan(0);
    expect(result.invalidExcerpts).toContain("这段文字不在草稿中");
  });

  it("ignores knowledge and inference evidence", () => {
    const j = structuredClone(validJudge);
    j.dimensions.relevance.findings[0].evidenceSource = "knowledge";
    j.dimensions.relevance.findings[0].evidence = "不在草稿中的知识库引用";
    const result = verifyDraftExcerpt(j, logic);
    expect(result.invalid).toBe(0);
  });
});

describe("score recomputation", () => {
  it("completeness score matches coverage recomputation", () => {
    expect(recomputeCompletenessScore(validJudge)).toBeNull();
  });

  it("completeness score mismatch is detected", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.completeness.score = 100;
    expect(recomputeCompletenessScore(bad)).toBe(75);
  });

  it("actionability score matches sub-metric average", () => {
    expect(recomputeActionabilityScore(validJudge)).toBeNull();
  });

  it("actionability score mismatch is detected", () => {
    const bad = structuredClone(validJudge);
    bad.dimensions.actionability.score = 100;
    expect(recomputeActionabilityScore(bad)).toBe(67);
  });

  it("boundaryRisk score matches risk recomputation", () => {
    expect(recomputeBoundaryRiskScore(validJudge)).toBeNull();
  });

  it("boundaryRisk null score when nothing is scored", () => {
    const j = structuredClone(validJudge);
    j.dimensions.boundaryRisk.score = null;
    for (const r of j.dimensions.boundaryRisk.risks) {
      r.status = "undetected" as typeof r.status;
    }
    expect(recomputeBoundaryRiskScore(j)).toBeNull();
  });
});

describe("evaluator skill directory archive", () => {
  it("packs successfully and produces a content hash", async () => {
    const skillDir = join(import.meta.dirname, "../workflows/response-logic-evaluator.skill");
    const archive = await buildDirectorySkillArchive({
      name: "response-logic-evaluator",
      version: "1",
      directoryCandidates: [skillDir],
      files: ["SKILL.md", "references/output-contract.md", "references/rubric.md"],
    });
    expect(archive.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(archive.bytes.length).toBeGreaterThan(0);
    expect(archive.version).toBe("1");
  });

  it("all four required files are non-empty", async () => {
    const skillDir = join(import.meta.dirname, "../workflows/response-logic-evaluator.skill");
    const files = ["SKILL.md", "references/output-contract.md", "references/rubric.md", "agents/openai.yaml"];
    for (const file of files) {
      const content = await readFile(join(skillDir, file), "utf8");
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });
});
