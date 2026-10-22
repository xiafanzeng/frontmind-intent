import {useMemo,useState} from "react";
import {buildDiagnosis,type DemoEvaluation,type LogicField} from "./mock-evaluation.js";
import {Score,WorkbenchCard,WorkbenchSteps} from "./workbench-parts.js";
import "./evaluation.css";

/** Presentation counterpart to brand IntentWorkbench's iw-evaluation. Data is frontend sample data; the diagnosis method area states this. */
export function ResponseLogicEvaluationPanel({evaluation,onBack,onOptimize,onLocate}:{evaluation:DemoEvaluation;onBack:()=>void;onOptimize:()=>void;onLocate?:(field:LogicField)=>void}){
  const {dimensions}=evaluation;
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const diagnoses=useMemo(()=>buildDiagnosis(evaluation),[evaluation]);
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
          <WorkbenchCard title="Answer Relevance"><Score value={dimensions.relevance.score}/><p className="rl-eval-score-description">{dimensions.relevance.reason}</p><details className="rl-eval-dimensions"><summary>查看相关性诊断 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content"><ul>{dimensions.relevance.issues.map((x,i)=><li key={i}>{x}</li>)}</ul><p><b>原文依据</b>{dimensions.relevance.evidence}</p><p><b>修改建议</b>{dimensions.relevance.suggestions.join("；")}</p><p><b>修改后预期</b>{dimensions.relevance.effect}</p><p className="rl-eval-submethod">{dimensions.relevance.method}</p></div></details></WorkbenchCard>
          <WorkbenchCard title="Completeness"><Score value={dimensions.completeness.score}/><p className="rl-eval-score-description">{dimensions.completeness.reason}</p><details className="rl-eval-dimensions"><summary>查看完整性详情：四项必要内容 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content rl-eval-detail-matrix"><p className="rl-eval-detail-heading">Completeness · 回答蓝图完整性</p><p>{dimensions.completeness.reason}</p><div className="rl-cov-list">{dimensions.completeness.coverage.map(item=><details className="rl-cov-item" key={item.field} open={item.status!=="covered"}><summary><b>{item.label}</b><span className={`rl-eval-tag ${item.status}`}>{item.statusText}</span><span className="rl-cov-chevron" aria-hidden="true">⌄</span></summary><div className="rl-cov-body"><p><b>覆盖情况</b>{item.situation}</p><p><b>判断依据</b>{item.basis}</p><p><b>修改建议</b>{item.suggestion}</p></div></details>)}</div></div></details></WorkbenchCard>
          <WorkbenchCard title="Actionability"><Score value={dimensions.actionability.score}/><p className="rl-eval-score-description">{dimensions.actionability.reason}</p><details className="rl-eval-dimensions"><summary>查看三个子维度 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.actionability.subMetrics.map(item=><div className="rl-eval-submetric" key={item.key}><div><b>{item.label}</b><span>{item.score} / 100 · {item.band}</span></div><p>{item.reason}</p><p className="rl-eval-evidence">文本依据：{item.evidence}</p><small>问题：{item.issue}</small><small>建议：{item.suggestion}</small><small>修改后预期：{item.effect}</small></div>)}</div></details></WorkbenchCard>
          <WorkbenchCard title="Boundary / Risk Control"><Score value={dimensions.boundaryRisk.score}/><p className="rl-eval-score-description">{dimensions.boundaryRisk.note}</p><details className="rl-eval-dimensions"><summary>查看风险检查清单 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.boundaryRisk.risks.map(risk=><div className="rl-eval-risk" key={risk.key}><b>{risk.label}</b><span className={`rl-eval-tag ${risk.status==="controlled"?"supported":risk.status==="partial"?"partial":risk.status==="uncontrolled"?"missing":"neutral"}`}>{risk.statusText}</span>{risk.excerpt&&<p className="rl-eval-evidence">原文片段：…{risk.excerpt}…</p>}<p>{risk.guidance}</p></div>)}<p className="rl-eval-submethod">{dimensions.boundaryRisk.method}</p></div></details></WorkbenchCard>
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
