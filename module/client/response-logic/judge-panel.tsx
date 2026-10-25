import type { JudgeOutput, JudgeFinding, JudgeEvidenceSource, JudgeEvidenceConfidence } from "../../contracts/response-logic-judge.js";
import type { JudgePhase } from "../use-judge-evaluation.js";

const evidenceSourceText: Record<JudgeEvidenceSource, string> = {
  draft: "草稿原文", knowledge: "知识材料", inference: "模型推断",
};
const confidenceText: Record<JudgeEvidenceConfidence, string> = {
  supported: "已验证", partial: "部分支撑", unverifiable: "无法验证",
};
const severityClass: Record<string, string> = { info: "neutral", improve: "partial", risk: "missing" };
const severityText: Record<string, string> = { info: "观察", improve: "待改进", risk: "风险" };
const relevanceBandText: Record<string, string> = {
  direct: "直接回应", mostly_relevant: "整体相关", partially_responsive: "部分回应",
  background_dominant: "背景为主", off_topic: "明显偏题",
};
const actionabilityBandText: Record<string, string> = {
  highly_actionable: "高度可执行", mostly_actionable: "基本可执行", moderately_actionable: "方向明确",
  vague: "笼统模糊", not_actionable: "无可执行指令",
};
const coverageFieldText: Record<string, string> = {
  concern: "用户真实关心", conclusion: "核心结论/执行口径", facts: "企业材料/官方依据", boundaries: "回答边界/禁止表达",
};
const coverageStatusText: Record<string, string> = { covered: "完整", partial: "部分覆盖", missing: "缺失" };
const riskKeyText: Record<string, string> = {
  unverified_ranking: "无依据排名", absolute_claim: "绝对化表达", effect_promise: "效果保证",
  unverified_comparison: "未经核实的比较", unsupported_fact: "事实性结论缺据", missing_precondition: "缺适用条件",
};
const riskStatusText: Record<string, string> = {
  controlled: "已明确控制", partial: "部分控制", uncontrolled: "发现风险但未控制",
  undetected: "未检出相关表述", not_applicable: "不适用", indeterminate: "无法判断",
};

function FindingItem({ finding }: { finding: JudgeFinding }) {
  return (
    <div className="rl-judge-finding">
      <div className="rl-judge-finding-head">
        <span className={`rl-eval-tag ${severityClass[finding.severity] ?? "neutral"}`}>{severityText[finding.severity] ?? finding.severity}</span>
        <span className="rl-eval-tag neutral">{evidenceSourceText[finding.evidenceSource]}</span>
        <span className={`rl-eval-tag ${finding.evidenceConfidence === "supported" ? "supported" : finding.evidenceConfidence === "partial" ? "partial" : "neutral"}`}>{confidenceText[finding.evidenceConfidence]}</span>
      </div>
      {finding.evidence && <blockquote className="rl-judge-evidence">「{finding.evidence}」</blockquote>}
      <p className="rl-judge-reason">{finding.reason}</p>
      <p className="rl-judge-suggestion"><b>建议</b>{finding.suggestion}</p>
    </div>
  );
}

function FindingsList({ findings }: { findings: JudgeFinding[] }) {
  if (!findings.length) return null;
  return <div className="rl-judge-findings">{findings.map((f, i) => <FindingItem key={i} finding={f} />)}</div>;
}

/** Status indicator shown when Judge is still running or has failed. */
export function JudgeStatusBanner({ phase, error }: { phase: JudgePhase; error?: string }) {
  if (phase === "running" || phase === "starting") {
    return <div className="rl-judge-status" role="status">LLM 语义评估进行中…（完成后自动补充到各维度）</div>;
  }
  if (phase === "failed") {
    return <div className="rl-judge-status rl-judge-status-failed" role="alert">LLM 语义评估{error ? `失败：${error}` : "未完成"} · 规则检查结果不受影响</div>;
  }
  return null;
}

/** Factory: returns a ReactNode for the Judge section of a specific dimension. */
export function renderJudgeDimension(
  judge: JudgeOutput,
  dimension: "relevance" | "completeness" | "actionability" | "boundaryRisk",
): React.ReactNode {
  const d = judge.dimensions;
  switch (dimension) {
    case "relevance":
      return <JudgeRelevance data={d.relevance} />;
    case "completeness":
      return <JudgeCompleteness data={d.completeness} />;
    case "actionability":
      return <JudgeActionability data={d.actionability} />;
    case "boundaryRisk":
      return <JudgeBoundaryRisk data={d.boundaryRisk} />;
  }
}

function JudgeRelevance({ data }: { data: JudgeOutput["dimensions"]["relevance"] }) {
  return <div className="rl-judge-section">
    <div className="rl-judge-section-head">
      <span className="rl-judge-source-tag">LLM 语义判断</span>
      <strong>{data.score}</strong>
      <span className="rl-eval-tag">{relevanceBandText[data.band] ?? data.band}</span>
    </div>
    <FindingsList findings={data.findings} />
  </div>;
}

function JudgeCompleteness({ data }: { data: JudgeOutput["dimensions"]["completeness"] }) {
  return <div className="rl-judge-section">
    <div className="rl-judge-section-head">
      <span className="rl-judge-source-tag">LLM 语义判断</span>
      <strong>{data.score}</strong>
    </div>
    <div className="rl-judge-coverage">
      {data.coverage.map(item => (
        <div key={item.field} className={`rl-judge-cov-item ${item.status}`}>
          <span className="rl-judge-cov-label">{coverageFieldText[item.field] ?? item.field}</span>
          <span className={`rl-eval-tag ${item.status === "covered" ? "supported" : item.status === "partial" ? "partial" : "missing"}`}>{coverageStatusText[item.status] ?? item.status}</span>
          <FindingsList findings={item.findings} />
        </div>
      ))}
    </div>
    <FindingsList findings={data.findings} />
  </div>;
}

function JudgeActionability({ data }: { data: JudgeOutput["dimensions"]["actionability"] }) {
  return <div className="rl-judge-section">
    <div className="rl-judge-section-head">
      <span className="rl-judge-source-tag">LLM 语义判断</span>
      <strong>{data.score}</strong>
    </div>
    <div className="rl-judge-submetrics">
      {data.subMetrics.map(sub => (
        <div key={sub.key} className="rl-judge-submetric">
          <div className="rl-judge-submetric-head">
            <span className="rl-judge-submetric-label">{coverageFieldText[sub.key] ?? sub.key}</span>
            <span className="rl-eval-tag neutral">{sub.score}</span>
            <span className="rl-eval-tag">{actionabilityBandText[sub.band] ?? sub.band}</span>
          </div>
          <FindingsList findings={sub.findings} />
        </div>
      ))}
    </div>
    <FindingsList findings={data.findings} />
  </div>;
}

function JudgeBoundaryRisk({ data }: { data: JudgeOutput["dimensions"]["boundaryRisk"] }) {
  return <div className="rl-judge-section">
    <div className="rl-judge-section-head">
      <span className="rl-judge-source-tag">LLM 语义判断</span>
      {data.score === null
        ? <span className="rl-eval-tag neutral">未评估</span>
        : <strong>{data.score}</strong>}
    </div>
    {data.score === null && <p className="rl-judge-null-note">无可计分的适用风险项（不代表风险控制已达标）</p>}
    <div className="rl-judge-risks">
      {data.risks.map(risk => (
        <div key={risk.key} className="rl-judge-risk-item">
          <span className="rl-judge-risk-label">{riskKeyText[risk.key] ?? risk.key}</span>
          <span className={`rl-eval-tag ${risk.status === "controlled" ? "supported" : risk.status === "partial" ? "partial" : risk.status === "uncontrolled" ? "missing" : "neutral"}`}>{riskStatusText[risk.status] ?? risk.status}</span>
          <FindingsList findings={risk.findings} />
        </div>
      ))}
    </div>
    <FindingsList findings={data.findings} />
  </div>;
}
