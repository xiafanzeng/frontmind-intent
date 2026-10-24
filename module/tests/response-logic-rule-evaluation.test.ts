import { describe, expect, it } from "vitest";
import {
  RULE_EVALUATION_VERSION,
  buildRuleDiagnosis,
  createResponseLogicRuleEvaluation,
  fingerprintLogic,
  ruleEvaluationSchema,
} from "../contracts/response-logic-evaluation";
import {
  createDemoEvaluation,
  createResponseLogicRuleEvaluation as clientEngineExport,
} from "../client/response-logic/mock-evaluation";

const logic = {
  concern: "用户关注机构资质与真实性，担心选错服务商，希望有可核验的判断标准",
  conclusion: "先核验资质与授权，再对比服务范围与成功案例，最后按适用条件收敛选择。",
  facts: "资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯",
  boundaries: "不使用绝对化承诺；排名表述必须给出样本范围与时间。",
};
const input = {
  questionId: "q1",
  question: "机构靠谱吗？如何判断服务商资质？",
  intent: "机构可信度与选型判断标准",
  version: 1,
  revision: 2,
  logic,
};

describe("response logic rule evaluation engine", () => {
  it("is the single shared engine behind the client preview alias", () => {
    expect(clientEngineExport).toBe(createResponseLogicRuleEvaluation);
    expect(createDemoEvaluation(input)).toEqual(createResponseLogicRuleEvaluation(input));
  });

  it("labels itself as deterministic rule evaluation, never as a semantic judge", () => {
    const result = createResponseLogicRuleEvaluation(input);
    expect(result.kind).toBe("rule-evaluation");
    expect(result.dimensions.relevance.method).toContain("规则评估");
    expect(result.dimensions.relevance.method).toContain("未接入 Ragas / DeepEval");
    expect(result.dimensions.boundaryRisk.method).toContain("规则评估");
    expect(result.dimensions.relevance.method).not.toContain("前端规则示例");
    expect(result.dimensions.boundaryRisk.method).not.toContain("前端规则示例");
  });

  it("keeps four independent dimensions with recomputable scores and no aggregate", () => {
    const result = createResponseLogicRuleEvaluation(input);
    expect(Object.keys(result.dimensions)).toEqual(["relevance", "completeness", "actionability", "boundaryRisk"]);
    expect("overall" in result).toBe(false);
    const cov = result.dimensions.completeness.coverage;
    const recomputedCompleteness = Math.round(cov.reduce((s, i) => s + (i.status === "covered" ? 100 : i.status === "partial" ? 50 : 0), 0) / 4);
    expect(result.dimensions.completeness.score).toBe(recomputedCompleteness);
    const subs = result.dimensions.actionability.subMetrics;
    expect(result.dimensions.actionability.score).toBe(Math.round(subs.reduce((s, i) => s + i.score, 0) / 3));
    const risks = result.dimensions.boundaryRisk.risks;
    expect(risks).toHaveLength(6);
    const scored = risks.filter((r) => r.status === "controlled" || r.status === "partial" || r.status === "uncontrolled");
    expect(result.dimensions.boundaryRisk.score).toBe(
      scored.length ? Math.round(scored.reduce((s, r) => s + (r.status === "controlled" ? 100 : r.status === "partial" ? 50 : 0), 0) / scored.length) : null,
    );
  });

  it("handles empty and abnormal fields without crashing or defaulting to full marks", () => {
    const empty = createResponseLogicRuleEvaluation({ ...input, logic: { concern: "", conclusion: "", facts: "", boundaries: "" } });
    expect(empty.dimensions.completeness.score).toBe(0);
    expect(empty.dimensions.completeness.coverage.every((i) => i.status === "missing")).toBe(true);
    const unscorable = createResponseLogicRuleEvaluation({
      ...input,
      logic: { ...logic, boundaries: "", conclusion: "背景介绍：知识管理是企业的重要能力。", facts: "" },
    });
    // 无适用计分风险时保持原语义：不做满分默认（可能仍有通用适用未控制项）。
    expect(unscorable.dimensions.boundaryRisk.score === null || unscorable.dimensions.boundaryRisk.score < 100).toBe(true);
  });

  it("is deterministic and does not mutate its input", () => {
    const before = JSON.stringify(input);
    expect(createResponseLogicRuleEvaluation(input)).toEqual(createResponseLogicRuleEvaluation(input));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("builds bounded diagnoses with stable ids and valid locate targets", () => {
    const diagnoses = buildRuleDiagnosis(createResponseLogicRuleEvaluation(input));
    expect(diagnoses.length).toBeGreaterThan(0);
    expect(diagnoses.length).toBeLessThanOrEqual(6);
    const validFields = ["concern", "conclusion", "facts", "boundaries"];
    for (const item of diagnoses) {
      expect(item.id).toMatch(/^dx-[a-z]+-/);
      expect(["relevance", "completeness", "actionability", "boundaryRisk"]).toContain(item.dimension);
      expect(validFields).toContain(item.targetField);
    }
    expect(new Set(diagnoses.map((i) => i.id)).size).toBe(diagnoses.length);
  });

  it("matches the wire contract schema and binds the content fingerprint", () => {
    const result = createResponseLogicRuleEvaluation(input);
    expect(() => ruleEvaluationSchema.parse(result)).not.toThrow();
    expect(result.sourceFingerprint).toBe(fingerprintLogic(logic));
    expect(result.logic).toEqual(logic);
  });

  it("carries an explicit rule version", () => {
    expect(typeof RULE_EVALUATION_VERSION).toBe("string");
    expect(RULE_EVALUATION_VERSION.length).toBeGreaterThan(0);
  });
});
