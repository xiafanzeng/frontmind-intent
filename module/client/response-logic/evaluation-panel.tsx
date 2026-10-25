import {useMemo,type ReactNode} from "react";
import {Score,WorkbenchCard,WorkbenchSteps} from "./workbench-parts.js";
import {JudgeRelevance,JudgeCompleteness,JudgeActionability,JudgeBoundaryRisk,JudgeStatusBanner} from "./judge-panel.js";
import type {JudgeOutput,JudgeFinding} from "../../contracts/response-logic-judge.js";
import type {JudgePhase} from "../use-judge-evaluation.js";
import "./evaluation.css";

type JudgeDiagnosisItem = {
  id: string;
  dimensionLabel: string;
  severity: "info" | "improve" | "risk";
  reason: string;
  suggestion: string;
};

const DIMENSION_LABELS = {relevance:"回答相关性",completeness:"完整性",actionability:"可执行性",boundaryRisk:"边界与风险控制"} as const;
const SEVERITY_CLASS: Record<string,string> = {info:"neutral",improve:"partial",risk:"missing"};
const SEVERITY_TEXT: Record<string,string> = {info:"观察",improve:"待改进",risk:"风险"};

/** Collect actionable findings (risk/improve) across all four judge dimensions. */
function collectJudgeDiagnoses(judge:JudgeOutput):JudgeDiagnosisItem[]{
  const items:JudgeDiagnosisItem[] = [];
  const push=(dimension:keyof typeof DIMENSION_LABELS,findings:JudgeFinding[],prefix:string)=>{
    for(const [index,finding] of findings.entries()){
      if(finding.severity==="info") continue;
      items.push({id:`${prefix}:${index}`,dimensionLabel:DIMENSION_LABELS[dimension],severity:finding.severity,reason:finding.reason,suggestion:finding.suggestion});
    }
  };
  const d=judge.dimensions;
  push("relevance",d.relevance.findings,"rel");
  d.completeness.coverage.forEach((item,i)=>push("completeness",item.findings,`cov${i}`));
  push("completeness",d.completeness.findings,"comp");
  d.actionability.subMetrics.forEach((item,i)=>push("actionability",item.findings,`sub${i}`));
  push("actionability",d.actionability.findings,"act");
  d.boundaryRisk.risks.forEach((item,i)=>push("boundaryRisk",item.findings,`risk${i}`));
  push("boundaryRisk",d.boundaryRisk.findings,"bound");
  return items;
}

/** Dependency-free math typesetting: stacked fractions, italic serif variables, subscripts. */
function Frac({num,den}:{num:ReactNode;den:ReactNode}){
  return <span className="rl-math"><span className="rl-math-frac"><span className="rl-math-num">{num}</span><span className="rl-math-den">{den}</span></span></span>;
}

/** Stable per-dimension rubric introductions; they describe the four-dimension
 * method and the server-side score recomputation rules, never a rule-engine score. */
const EVALUATION_RULES:Record<string,ReactNode>={
  relevance:<>
    <p><b>评估目的</b>判断应答逻辑是否直接回应当前 Question 和 Intent。</p>
    <p><b>重点检查</b>是否回答核心问题；是否识别用户真正关心的决策内容；是否围绕当前 Intent 展开而非泛泛介绍；是否存在偏题或回避问题。</p>
    <p><b>不负责评价</b>必要组成部分是否齐全（归「完整性」）；执行指引是否具体（归「可执行性」）；风险边界是否充分（归「边界与风险控制」）。</p>
    <p><b>评分规则</b>五档区间：90–100 直接回应；75–89 整体相关；60–74 部分回应；40–59 以背景为主；0–39 明显偏题。区间内按结论首句回应、意图贯穿等结构信号微调。</p>
  </>,
  completeness:<>
    <p><b>评估目的</b>检查后续内容生成必需的四项内容是否覆盖：用户真实关心、核心结论 / 执行口径、企业材料 / 官方依据、回答边界 / 禁止表达。</p>
    <p><b>判断标准</b>每项独立判定「完整」（100）、「部分覆盖」（50）或「缺失」（0）。</p>
    <p><b>一致性校验</b>程序会按下式复算维度分并与模型声明比对，不一致将被拒绝。</p>
    <div className="rl-math-block"><span className="rl-math-name">完整性</span><span className="rl-math-eq">=</span><span className="rl-math-fn">round</span><span className="rl-math-paren">(</span><Frac num={<><span className="rl-math-var">s</span><sub>1</sub> + <span className="rl-math-var">s</span><sub>2</sub> + <span className="rl-math-var">s</span><sub>3</sub> + <span className="rl-math-var">s</span><sub>4</sub></>} den="4"/><span className="rl-math-paren">)</span></div>
    <p className="rl-math-note">其中 <span className="rl-math-var">s</span><sub>i</sub> 为第 i 项必要内容的覆盖分（完整 = 100、部分覆盖 = 50、缺失 = 0），结果四舍五入为整数。</p>
    <p><b>不负责评价</b>内容是否具体可执行（归「可执行性」）；结论是否切题（归「回答相关性」）；边界约束是否足够针对风险（归「边界与风险控制」）。只判覆盖，不做质量重复扣分。</p>
  </>,
  actionability:<>
    <p><b>评估目的</b>判断后续 Content Agent 能否仅依据当前应答逻辑开展内容生成：明确写什么、依据什么、按什么顺序组织。</p>
    <p><b>三个子维度</b>内容具体度（是否给出信息点、步骤与判断条件，检出「突出优势」类笼统指令将扣分）；证据指引（事实与来源如何映射、缺据如何处理）；结构引导（展开顺序与段落组织要求）。</p>
    <p><b>评分规则</b>每个子维度按 90/75/60/40/0 区间独立评分并附文本依据。</p>
    <p><b>一致性校验</b>程序会复算三个子维度的算术平均值（四舍五入）并与模型声明比对，不一致将被拒绝。</p>
    <div className="rl-math-block"><span className="rl-math-name">可执行性</span><span className="rl-math-eq">=</span><span className="rl-math-fn">round</span><span className="rl-math-paren">(</span><Frac num={<><span className="rl-math-var">a</span><sub>1</sub> + <span className="rl-math-var">a</span><sub>2</sub> + <span className="rl-math-var">a</span><sub>3</sub></>} den="3"/><span className="rl-math-paren">)</span></div>
    <p className="rl-math-note">其中 <span className="rl-math-var">a</span><sub>i</sub> 为第 i 个子维度（内容具体度 / 证据指引 / 结构引导）的独立得分，取值 0–100，结果四舍五入为整数。</p>
    <p><b>不负责评价</b>内容完整不等同于可执行；覆盖齐全与否归「完整性」单独评估。</p>
  </>,
  boundaryRisk:<>
    <p><b>评估目的</b>判断应答逻辑是否识别当前场景的风险，并明确规定哪些内容不能说、需核验或必须附带限制条件。</p>
    <p><b>重点检查</b>六类风险：无依据排名、绝对化表达、缺乏依据的效果保证、未经核实的比较、缺少依据的事实性结论、缺失必要适用条件。逐类区分「缺少事实依据」（正文问题）与「未明确设置回答边界」（约束缺失）。</p>
    <p><b>评分规则</b>每类适用风险独立判定：已明确控制 = 100、部分控制 = 50、发现风险但未控制 = 0。</p>
    <p><b>一致性校验</b>程序按计分风险复算维度分并与模型声明比对；无可计分风险项时分数必须为 null（未评估），任何数字分都会被拒绝。</p>
    <div className="rl-math-block"><span className="rl-math-name">边界与风险控制</span><span className="rl-math-eq">=</span><span className="rl-math-fn">round</span><span className="rl-math-paren">(</span><Frac num={<><span className="rl-math-op">Σ</span><sub><span className="rl-math-var">i</span>∈<span className="rl-math-var">D</span></sub> <span className="rl-math-fn">score</span>(<span className="rl-math-var">i</span>)</>} den={<><span className="rl-math-op">|</span><span className="rl-math-var">D</span><span className="rl-math-op">|</span></>}/><span className="rl-math-paren">)</span></div>
    <p className="rl-math-note">其中 <span className="rl-math-var">D</span> 为计入评分的风险集合（已明确控制 / 部分控制 / 未控制）；「未检出 / 不适用 / 无法判断」∉ <span className="rl-math-var">D</span>、不计入分母。当 <span className="rl-math-op">|</span><span className="rl-math-var">D</span><span className="rl-math-op">|</span> = 0 时显示「未评估」，绝不默认满分。</p>
  </>,
};

/** One dimension card: LLM score + LLM findings + rubric introduction. */
function DimensionCard({title,rules,children}:{title:string;rules:ReactNode;children:ReactNode}){
  return <WorkbenchCard title={title}>
    {children}
    <div className="rl-eval-tabs">
      <details className="rl-eval-tab" name={`eval-${title}`}>
        <summary>评估规则介绍<span className="rl-tab-chevron" aria-hidden="true">⌄</span></summary>
        <div className="rl-eval-detail-content rl-eval-rules">{rules}</div>
      </details>
    </div>
  </WorkbenchCard>;
}

/**
 * The formal four-dimension evaluation report. The LLM-as-Judge is the sole
 * scoring source: every score, finding, excerpt and suggestion shown here comes
 * from the judge output; the rule engine is internal-only and never rendered.
 */
export function ResponseLogicEvaluationPanel({question,intent,judgePhase,judgeResult,judgeError,dataSourceLabel,onBack,onOptimize,onRetry}:{question:string;intent:string;judgePhase:JudgePhase;judgeResult:JudgeOutput|null;judgeError?:string;dataSourceLabel?:string;onBack:()=>void;onOptimize:()=>void;onRetry?:()=>void}){
  const hasResult = judgePhase==="completed" && judgeResult;
  const diagnoses=useMemo(()=>hasResult?collectJudgeDiagnoses(judgeResult):[],[hasResult,judgeResult]);
  const status=diagnoses.some(item=>item.severity==="risk")
    ?{label:"存在风险",tone:"risk" as const}
    :diagnoses.length?{label:"待完善",tone:"improve" as const}
    :{label:"暂无待处理问题",tone:"ok" as const};
  return <section className="rl-eval-root" aria-label="应答逻辑评估">
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={onBack}>← 返回应答逻辑详情</button></div>
    <header className="rl-eval-heading"><div><h2>应答逻辑评估 · {question}</h2><p>Intent：{intent||"未提供"} · 四项独立评分，不设综合分 · LLM 语义评估</p></div></header>
    {judgePhase!=="idle" && judgePhase!=="completed" && <JudgeStatusBanner phase={judgePhase} error={judgePhase==="failed"?judgeError:undefined} />}
    <WorkbenchSteps step={1}/>
    {!hasResult && <div className="rl-eval-main"><div className="rl-eval-grid">
      {judgePhase==="failed"
        ?<WorkbenchCard title="LLM 语义评估未完成">
          <p className="rl-eval-score-description">本次 LLM 语义评估未能完成，四维评分不可用。{judgeError?`（${judgeError}）`:""}请稍后重试；评估失败不会修改应答逻辑内容。</p>
          {onRetry&&<div className="rl-eval-actions" style={{marginTop:12}}><button type="button" className="rl-eval-primary" onClick={onRetry}>重新发起评估</button></div>}
        </WorkbenchCard>
        :judgePhase==="idle"
          ?<WorkbenchCard title="尚未评估"><p className="rl-eval-score-description">当前应答逻辑尚未发起 LLM 语义评估。</p></WorkbenchCard>
          :<WorkbenchCard title="LLM 语义评估进行中">
            <p className="rl-eval-score-description">模型正在基于当前 Question、Intent、应答逻辑四栏内容与可用企业知识材料进行四维语义评估，完成后结果自动展示。通常需要 1–3 分钟。</p>
          </WorkbenchCard>}
    </div></div>}
    {hasResult && (()=>{const d=judgeResult.dimensions;return <>
    <div className="rl-eval-layout">
      <div className="rl-eval-main">
        <div className="rl-eval-grid">
          <DimensionCard title="回答相关性" rules={EVALUATION_RULES.relevance}>
            <Score value={d.relevance.score}/>
            <JudgeRelevance data={d.relevance}/>
          </DimensionCard>
          <DimensionCard title="完整性" rules={EVALUATION_RULES.completeness}>
            <Score value={d.completeness.score}/>
            <JudgeCompleteness data={d.completeness}/>
          </DimensionCard>
          <DimensionCard title="可执行性" rules={EVALUATION_RULES.actionability}>
            <Score value={d.actionability.score}/>
            <JudgeActionability data={d.actionability}/>
          </DimensionCard>
          <DimensionCard title="边界与风险控制" rules={EVALUATION_RULES.boundaryRisk}>
            <Score value={d.boundaryRisk.score}/>
            <JudgeBoundaryRisk data={d.boundaryRisk}/>
          </DimensionCard>
        </div>
      </div>
      <aside className="rl-eval-diagnosis rl-eval-card"><h3>诊断摘要 <span className={`rl-dx-status ${status.tone}`}>{status.label}</span><small>{diagnoses.length ? `${diagnoses.length} 项待处理` : ""}</small></h3>
        <p className="rl-judge-overall">{judgeResult.overallAssessment}</p>
        {diagnoses.length?<div className="rl-dx-list">{diagnoses.map(item=><details className="rl-dx-item" key={item.id}>
          <summary><b>{item.dimensionLabel}</b><span className={`rl-eval-tag ${SEVERITY_CLASS[item.severity]}`}>{SEVERITY_TEXT[item.severity]}</span><span className="rl-cov-chevron" aria-hidden="true">⌄</span></summary>
          <div className="rl-dx-body">
            <p><b>问题原因</b>{item.reason}</p>
            <p><b>修改建议</b>{item.suggestion}</p>
          </div>
        </details>)}</div>:<p className="rl-dx-empty">当前四维评估未发现待处理问题。</p>}
        <div className="rl-eval-diagnosis-method">数据来源：{dataSourceLabel ?? "LLM 语义评估（异步模型任务）"}<br/>评分为会话内结果；内容变化或刷新后需重新评估。</div></aside>
    </div>
    <div className="rl-eval-actions"><span>优化建议需人工审核后采用；采用为本地预览状态，不写入服务器。</span><button type="button" className="rl-eval-outline" onClick={onBack}>返回详情</button><button type="button" className="rl-eval-primary" onClick={onOptimize}>生成优化方案 →</button></div>
    </>;})()}
  </section>;
}
