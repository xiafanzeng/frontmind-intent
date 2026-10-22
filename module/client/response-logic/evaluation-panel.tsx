import {useMemo,useState,type ReactNode} from "react";
import {buildDiagnosis,type DemoEvaluation,type LogicField} from "./mock-evaluation.js";
import {Score,WorkbenchCard,WorkbenchSteps} from "./workbench-parts.js";
import "./evaluation.css";

/** Short, data-driven card summaries (1–2 sentences). Details live behind the card's tabs. */
function summarize(evaluation: DemoEvaluation){
  const d=evaluation.dimensions;
  const cov=d.completeness.coverage;
  const counts={covered:cov.filter(i=>i.status==="covered").length,partial:cov.filter(i=>i.status==="partial").length,missing:cov.filter(i=>i.status==="missing").length};
  const weakest=d.actionability.subMetrics.reduce((a,b)=>b.score<a.score?b:a);
  const scored=d.boundaryRisk.risks.filter(r=>r.status==="controlled"||r.status==="partial"||r.status==="uncontrolled");
  const controlled=scored.filter(r=>r.status==="controlled").length;
  return {
    relevance:d.relevance.score>=90
      ?"结论直接回应了问题主语与意图，未发现明显偏题。"
      :`${d.relevance.band}${d.relevance.issues.length?`；${d.relevance.issues[0].replace(/。$/,"")}`:""}。`,
    completeness:`四项必要内容：${counts.covered} 完整 / ${counts.partial} 部分覆盖 / ${counts.missing} 缺失。`,
    actionability:`三个子维度中「${weakest.label.split("（")[0]}」最弱（${weakest.score} 分）${weakest.score<75?"，执行口径需要更具体":""}。`,
    boundaryRisk:d.boundaryRisk.score===null
      ?"暂不可评分：当前没有可计分的适用风险项（不代表风险控制已达标）。"
      :`${scored.length} 类适用风险计入评分，其中 ${controlled} 类已明确控制${scored.length-controlled>0?`、${scored.length-controlled} 类控制不足`:""}。`,
  };
}

/** Stable per-dimension rule introductions; they never change with a single evaluation. */
const EVALUATION_RULES:Record<string,ReactNode>={
  relevance:<>
    <p><b>评估目的</b>判断应答逻辑是否直接回应当前 Question 和 Intent。</p>
    <p><b>重点检查</b>是否回答核心问题；是否识别用户真正关心的决策内容；是否围绕当前 Intent 展开而非泛泛介绍；是否存在偏题或回避问题。</p>
    <p><b>不负责评价</b>必要组成部分是否齐全（归 Completeness）；执行指引是否具体（归 Actionability）；风险边界是否充分（归 Boundary / Risk Control）。</p>
    <p><b>评分规则</b>五档区间：90–100 直接回应；75–89 整体相关；60–74 部分回应；40–59 以背景为主；0–39 明显偏题。区间内按结论首句回应、意图贯穿等结构信号微调。</p>
  </>,
  completeness:<>
    <p><b>评估目的</b>检查后续内容生成必需的四项内容是否覆盖：用户真实关心、核心结论 / 执行口径、企业材料 / 官方依据、回答边界 / 禁止表达。</p>
    <p><b>判断标准</b>每项独立判定「完整」（100）、「部分覆盖」（50）或「缺失」（0）；Completeness = 四项均值，四舍五入。</p>
    <p><b>不负责评价</b>内容是否具体可执行（归 Actionability）；结论是否切题（归 Answer Relevance）；边界约束是否足够针对风险（归 Boundary / Risk Control）。只判覆盖，不做质量重复扣分。</p>
  </>,
  actionability:<>
    <p><b>评估目的</b>判断后续 Content Agent 能否仅依据当前应答逻辑开展内容生成：明确写什么、依据什么、按什么顺序组织。</p>
    <p><b>三个子维度</b>内容具体度（是否给出信息点、步骤与判断条件，检出「突出优势」类笼统指令将扣分）；证据指引（事实与来源如何映射、缺据如何处理）；结构引导（展开顺序与段落组织要求）。</p>
    <p><b>评分规则</b>每个子维度按 90/75/60/40/0 区间独立评分并附文本依据；Actionability = 三子项均值，四舍五入。</p>
    <p><b>不负责评价</b>内容完整不等同于可执行；覆盖齐全与否归 Completeness 单独评估。</p>
  </>,
  boundaryRisk:<>
    <p><b>评估目的</b>判断应答逻辑是否识别当前场景的风险，并明确规定哪些内容不能说、需核验或必须附带限制条件。</p>
    <p><b>重点检查</b>六类风险：无依据排名、绝对化表达、缺乏依据的效果保证、未经核实的比较、缺少依据的事实性结论、缺失必要适用条件。逐类区分「缺少事实依据」（正文问题）与「未明确设置回答边界」（约束缺失）。</p>
    <p><b>评分规则</b>已明确控制 = 100、部分控制 = 50、发现风险但未控制 = 0；未检出 / 不适用 / 无法判断不计入分母。分母为 0 时显示「未评估」，绝不默认满分。</p>
  </>,
};

/** One dimension card: score + 1–2 sentence summary + two parallel expandable tabs (details / rules). */
function DimensionCard({title,ruleKey,scoreValue,summary,detail,rules}:{title:string;ruleKey:string;scoreValue:number|null;summary:string;detail:ReactNode;rules:ReactNode}){
  return <WorkbenchCard title={title}>
    <Score value={scoreValue}/>
    <p className="rl-eval-score-description">{summary}</p>
    <div className="rl-eval-tabs">
      <details className="rl-eval-tab" name={`eval-${ruleKey}`}>
        <summary>查看详情 <span aria-hidden="true">⌄</span></summary>
        <div className="rl-eval-detail-content">{detail}</div>
      </details>
      <details className="rl-eval-tab" name={`eval-${ruleKey}`}>
        <summary>评估规则介绍 <span aria-hidden="true">⌄</span></summary>
        <div className="rl-eval-detail-content rl-eval-rules">{rules}</div>
      </details>
    </div>
  </WorkbenchCard>;
}

/** Presentation counterpart to brand IntentWorkbench's iw-evaluation. Data is frontend sample data; the diagnosis method area states this. */
export function ResponseLogicEvaluationPanel({evaluation,onBack,onOptimize,onLocate}:{evaluation:DemoEvaluation;onBack:()=>void;onOptimize:()=>void;onLocate?:(field:LogicField)=>void}){
  const {dimensions}=evaluation;
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const diagnoses=useMemo(()=>buildDiagnosis(evaluation),[evaluation]);
  const summary=useMemo(()=>summarize(evaluation),[evaluation]);
  const status=diagnoses.some(item=>item.severity==="risk")
    ?{label:"存在风险",tone:"risk" as const}
    :diagnoses.length?{label:"待完善",tone:"improve" as const}
    :{label:"暂无待处理问题",tone:"ok" as const};
  return <section className="rl-eval-root" aria-label="应答逻辑评估">
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={onBack}>← 返回应答逻辑详情</button></div>
    <header className="rl-eval-heading"><div><h2>应答逻辑评估 · {evaluation.question}</h2><p>Intent：{evaluation.intent||"未提供"} · 四项独立评分，不设综合分</p></div></header>
    <WorkbenchSteps step={1}/>
    <div className="rl-eval-layout">
      <div className="rl-eval-main">
        <div className="rl-eval-grid">
          <DimensionCard title="Answer Relevance" ruleKey="relevance" scoreValue={dimensions.relevance.score} summary={summary.relevance}
            detail={<>
              <ul className="rl-eval-issues">{dimensions.relevance.issues.map((x,i)=><li key={i}>{x}</li>)}</ul>
              <p><b>原文依据</b>{dimensions.relevance.evidence}</p>
              <p><b>修改建议</b>{dimensions.relevance.suggestions.join("；")}</p>
              <p><b>修改后预期</b>{dimensions.relevance.effect}</p>
              <p className="rl-eval-submethod">{dimensions.relevance.method}</p>
            </>}
            rules={EVALUATION_RULES.relevance}/>
          <DimensionCard title="Completeness" ruleKey="completeness" scoreValue={dimensions.completeness.score} summary={summary.completeness}
            detail={<div className="rl-cov-list">{dimensions.completeness.coverage.map(item=><details className="rl-cov-item" key={item.field} open={item.status!=="covered"}><summary><b>{item.label}</b><span className={`rl-eval-tag ${item.status}`}>{item.statusText}</span><span className="rl-cov-chevron" aria-hidden="true">⌄</span></summary><div className="rl-cov-body"><p><b>覆盖情况</b>{item.situation}</p><p><b>判断依据</b>{item.basis}</p><p><b>修改建议</b>{item.suggestion}</p></div></details>)}</div>}
            rules={EVALUATION_RULES.completeness}/>
          <DimensionCard title="Actionability" ruleKey="actionability" scoreValue={dimensions.actionability.score} summary={summary.actionability}
            detail={dimensions.actionability.subMetrics.map(item=><div className="rl-eval-submetric" key={item.key}><div className="rl-eval-submetric-head"><b>{item.label}</b><span>{item.score} / 100 · {item.band}</span></div><p>{item.reason}</p><p className="rl-eval-evidence">文本依据：{item.evidence}</p><small>问题：{item.issue}</small><small>建议：{item.suggestion}</small><small>修改后预期：{item.effect}</small></div>)}
            rules={EVALUATION_RULES.actionability}/>
          <DimensionCard title="Boundary / Risk Control" ruleKey="boundary" scoreValue={dimensions.boundaryRisk.score} summary={summary.boundaryRisk}
            detail={<>
              {dimensions.boundaryRisk.risks.map(risk=><div className="rl-eval-risk" key={risk.key}><b>{risk.label}</b><span className={`rl-eval-tag ${risk.status==="controlled"?"supported":risk.status==="partial"?"partial":risk.status==="uncontrolled"?"missing":"neutral"}`}>{risk.statusText}</span>{risk.excerpt&&<p className="rl-eval-evidence">原文片段：…{risk.excerpt}…</p>}<p>{risk.guidance}</p></div>)}
              <p className="rl-eval-submethod">计分口径：{dimensions.boundaryRisk.note}</p>
              <p className="rl-eval-submethod">{dimensions.boundaryRisk.method}</p>
            </>}
            rules={EVALUATION_RULES.boundaryRisk}/>
        </div>
      </div>
      <aside className="rl-eval-diagnosis rl-eval-card"><h3>诊断摘要 <span className={`rl-dx-status ${status.tone}`}>{status.label}</span><small>{diagnoses.length ? `${diagnoses.length} 项待处理` : ""}</small></h3>
        {diagnoses.length?<div className="rl-dx-list">{diagnoses.map(item=><details className="rl-dx-item" key={item.id} open={expandedId===item.id} onToggle={event=>setExpandedId(event.currentTarget.open?item.id:null)}>
          <summary><b>{item.title}</b><span className="rl-dx-dim">{item.dimensionLabel}</span><span className={`rl-eval-tag ${item.severity==="risk"?"missing":"partial"}`}>{item.severity==="risk"?"风险提示":"需完善"}</span><span className="rl-cov-chevron" aria-hidden="true">⌄</span></summary>
          <div className="rl-dx-body">
            <p><b>问题原因</b>{item.reason}</p>
            <p><b>对应内容</b>{item.dimensionLabel} · {item.targetLabel}：<span className="rl-eval-evidence">{item.excerpt||"（当前为空）"}{item.excerpt.length>=80?"…":""}</span></p>
            <p><b>修改建议</b>{item.suggestion}</p>
            <p><b>修改后预期</b>{item.effect}</p>
            <button type="button" className="rl-dx-locate" onClick={()=>onLocate?.(item.targetField)}>定位到对应内容 →</button>
          </div>
        </details>)}</div>:<p className="rl-dx-empty">当前四项检查未发现待处理问题。</p>}
        <div className="rl-eval-diagnosis-method">数据来源：前端示例数据（基于当前文本的规则展示，未接入真实 Judge / Ragas / DeepEval）<br/>Question ID：{evaluation.questionId}<br/>对应版本：{evaluation.version===null?"未发布":`v${evaluation.version}`} · Revision {evaluation.revision} · 内容指纹已绑定，版本变化后需重新评估</div></aside>
    </div>
    <div className="rl-eval-actions"><span>优化建议需人工审核后采用；采用为本地预览状态，不写入服务器。</span><button type="button" className="rl-eval-outline" onClick={onBack}>返回详情</button><button type="button" className="rl-eval-primary" onClick={onOptimize}>生成优化方案 →</button></div>
  </section>;
}
