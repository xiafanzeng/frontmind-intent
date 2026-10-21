import type {DemoEvaluation} from "./mock-evaluation.js";
import {Score,WorkbenchCard,WorkbenchSteps} from "./workbench-parts.js";
import "./evaluation.css";

/** Presentation counterpart to brand IntentWorkbench's iw-evaluation. Data is frontend sample data; the diagnosis method area states this. */
export function ResponseLogicEvaluationPanel({evaluation,onBack,onOptimize}:{evaluation:DemoEvaluation;onBack:()=>void;onOptimize:()=>void}){
  const {dimensions}=evaluation;
  const findings=[
    ...dimensions.relevance.issues,
    ...dimensions.completeness.coverage.filter(item=>item.status!=="covered").map(item=>`${item.label.split("（")[0]}：${item.status==="missing"?"缺失":item.status==="partial"?"部分覆盖":"完整"} —— ${item.suggestion}`),
    ...dimensions.actionability.subMetrics.filter(item=>item.score<80).map(item=>`${item.label.split("（")[0]} ${item.score} 分：${item.suggestion}`),
    dimensions.boundaryRisk.note,
  ];
  return <section className="rl-eval-root" aria-label="应答逻辑评估">
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={onBack}>← 返回应答逻辑详情</button></div>
    <header className="rl-eval-heading"><div><h2>应答逻辑评估 · {evaluation.question}</h2><p>Intent：{evaluation.intent||"未提供"} · 四项独立评分，不设综合分</p></div></header>
    <WorkbenchSteps step={1}/>
    <div className="rl-eval-layout">
      <div className="rl-eval-main">
        <div className="rl-eval-grid">
          <WorkbenchCard title="Answer Relevance"><Score value={dimensions.relevance.score}/><p className="rl-eval-score-description">{dimensions.relevance.reason}</p><details className="rl-eval-dimensions"><summary>查看相关性诊断 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content"><ul>{dimensions.relevance.issues.map((x,i)=><li key={i}>{x}</li>)}</ul><p><b>修改建议：</b>{dimensions.relevance.suggestions.join("；")}</p><p className="rl-eval-submethod">{dimensions.relevance.method}</p></div></details></WorkbenchCard>
          <WorkbenchCard title="Completeness"><Score value={dimensions.completeness.score}/><p className="rl-eval-score-description">{dimensions.completeness.reason}</p><details className="rl-eval-dimensions"><summary>查看五项必要内容 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.completeness.coverage.map(item=><div className="rl-eval-submetric" key={item.key}><div><b>{item.label}</b><span className={`rl-eval-tag ${item.status}`}>{item.status==="covered"?"完整":item.status==="partial"?"部分覆盖":"缺失"}</span></div><p>{item.reason}</p><small>{item.suggestion}</small></div>)}</div></details></WorkbenchCard>
          <WorkbenchCard title="Actionability"><Score value={dimensions.actionability.score}/><p className="rl-eval-score-description">{dimensions.actionability.reason}</p><details className="rl-eval-dimensions"><summary>查看三个子维度 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.actionability.subMetrics.map(item=><div className="rl-eval-submetric" key={item.key}><div><b>{item.label}</b><span>{item.score} / 100</span></div><p>{item.reason}</p><small>{item.suggestion}</small></div>)}</div></details></WorkbenchCard>
          <WorkbenchCard title="Boundary / Risk Control"><Score value={dimensions.boundaryRisk.score}/><p className="rl-eval-score-description">{dimensions.boundaryRisk.note}</p><details className="rl-eval-dimensions"><summary>查看风险检查清单 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.boundaryRisk.risks.map((risk,i)=><div className="rl-eval-risk" key={i}><b>{risk.kind}</b><span className={`rl-eval-tag ${risk.controlled?"supported":risk.status==="已识别未设边界"?"partial":""}`}>{risk.status}</span>{risk.excerpt&&<p className="rl-eval-evidence">原文片段：…{risk.excerpt}…</p>}<p>{risk.guidance}</p></div>)}<p className="rl-eval-submethod">{dimensions.boundaryRisk.method}</p></div></details></WorkbenchCard>
        </div>
        <section className="rl-eval-matrix rl-eval-card">
          <h3>回答蓝图完整性矩阵 <small>5 项必要内容</small></h3>
          <div className="rl-eval-table-scroll"><table><thead><tr><th>必要组成部分</th><th>覆盖状态</th><th>覆盖说明 / 修改建议</th></tr></thead><tbody>{dimensions.completeness.coverage.map(item=><tr key={item.key}><td><b>{item.label}</b></td><td><span className={`rl-eval-tag ${item.status}`}>{item.status==="covered"?"完整":item.status==="partial"?"部分覆盖":"缺失"}</span></td><td>{item.reason}<p className="rl-eval-evidence">{item.suggestion}</p></td></tr>)}</tbody></table></div>
        </section>
      </div>
      <aside className="rl-eval-diagnosis rl-eval-card"><h3>诊断摘要</h3><div className="rl-eval-findings">{findings.map((finding,i)=><p key={i}><span aria-hidden="true">✦</span>{finding}</p>)}</div><div className="rl-eval-diagnosis-method">数据来源：前端示例数据（基于当前文本的规则展示，未接入真实 Judge / Ragas / DeepEval）<br/>Question ID：{evaluation.questionId}<br/>对应版本：{evaluation.version===null?"未发布":`v${evaluation.version}`} · Revision {evaluation.revision} · 内容指纹已绑定，版本变化后需重新评估</div></aside>
    </div>
    <div className="rl-eval-actions"><span>优化建议需人工审核后采用；采用为本地预览状态，不写入服务器。</span><button type="button" className="rl-eval-outline" onClick={onBack}>返回详情</button><button type="button" className="rl-eval-primary" onClick={onOptimize}>生成优化方案 →</button></div>
  </section>;
}
