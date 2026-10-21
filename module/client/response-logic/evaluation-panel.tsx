import type {DemoEvaluation} from "./mock-evaluation.js";
import {DemoBanner,Score,WorkbenchCard,WorkbenchSteps} from "./workbench-parts.js";
import "./evaluation.css";

/** Presentation-only counterpart to brand IntentWorkbench's iw-evaluation. */
export function ResponseLogicEvaluationPanel({evaluation,onBack,onOptimize}:{evaluation:DemoEvaluation;onBack:()=>void;onOptimize:()=>void}){
  const {dimensions}=evaluation;
  const findings=[
    ...dimensions.relevance.issues,
    ...dimensions.completeness.coverage.filter(item=>item.status!=="covered").map(item=>`${item.label}：${item.reason}`),
    ...dimensions.actionability.subMetrics.filter(item=>item.score<80).map(item=>`${item.label}：${item.suggestion}`),
    dimensions.boundaryRisk.judgeRan?dimensions.boundaryRisk.note:"Boundary / Risk Control 尚未运行 Judge，不能据此判断风险已受控。",
  ];
  return <section className="rl-eval-root" aria-label="应答逻辑演示评估">
    <DemoBanner/>
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={onBack}>← 返回应答逻辑详情</button></div>
    <header className="rl-eval-heading"><div><h2>应答逻辑评估 · {evaluation.question}</h2><p>Intent：{evaluation.intent||"未提供"} · 四维独立评分 · 仅供演示</p></div><span className="rl-eval-tag">模拟结果</span></header>
    <WorkbenchSteps step={1}/>
    <div className="rl-eval-layout">
      <div className="rl-eval-main">
        <div className="rl-eval-grid">
          <WorkbenchCard title="Answer Relevance"><Score value={dimensions.relevance.score}/><p className="rl-eval-score-description">{dimensions.relevance.reason}</p><details className="rl-eval-dimensions"><summary>查看相关性诊断 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content"><ul>{dimensions.relevance.issues.map((x,i)=><li key={i}>{x}</li>)}</ul><p>{dimensions.relevance.suggestions.join("；")}</p></div></details></WorkbenchCard>
          <WorkbenchCard title="Completeness"><Score value={dimensions.completeness.score}/><p className="rl-eval-score-description">{dimensions.completeness.reason}</p><details className="rl-eval-dimensions"><summary>查看五项必要内容 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content"><p>已覆盖 {dimensions.completeness.coverage.filter(x=>x.status==="covered").length} / 5 项；完整度仅按文本存在和长度模拟。</p></div></details></WorkbenchCard>
          <WorkbenchCard title="Actionability"><Score value={dimensions.actionability.score}/><p className="rl-eval-score-description">{dimensions.actionability.reason}</p><details className="rl-eval-dimensions"><summary>查看三个子维度 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.actionability.subMetrics.map(item=><div className="rl-eval-submetric" key={item.key}><div><b>{item.label}</b><span>{item.score} / 100</span></div><p>{item.reason}</p><small>{item.suggestion}</small></div>)}</div></details></WorkbenchCard>
          <WorkbenchCard title="Boundary / Risk Control"><Score value={dimensions.boundaryRisk.score}/><p className="rl-eval-score-description">{dimensions.boundaryRisk.note}</p><details className="rl-eval-dimensions"><summary>查看风险检查清单 <span aria-hidden="true">⌄</span></summary><div className="rl-eval-detail-content">{dimensions.boundaryRisk.risks.map((risk,i)=><div className="rl-eval-risk" key={i}><b>{risk.kind}</b><span className="rl-eval-tag partial">{risk.controlled?"有边界文本，待核验":"需补充边界"}</span><p>{risk.guidance}</p></div>)}<p>“缺少事实依据”和“未设置回答边界”应由真实 Judge 分别识别。</p></div></details></WorkbenchCard>
        </div>
        <section className="rl-eval-matrix rl-eval-card">
          <h3>回答蓝图完整性矩阵 <small>5 项必要内容</small></h3>
          <div className="rl-eval-table-scroll"><table><thead><tr><th>必要组成部分</th><th>覆盖状态</th><th>覆盖说明 / 修改建议</th></tr></thead><tbody>{dimensions.completeness.coverage.map(item=><tr key={item.key}><td><b>{item.label}</b></td><td><span className={`rl-eval-tag ${item.status}`}>{item.status==="covered"?"形式覆盖":item.status==="partial"?"部分覆盖":"缺失"}</span></td><td>{item.reason}<p className="rl-eval-evidence">{item.suggestion}</p></td></tr>)}</tbody></table></div>
        </section>
      </div>
      <aside className="rl-eval-diagnosis rl-eval-card"><h3>诊断摘要</h3><div className="rl-eval-findings">{findings.map((finding,i)=><p key={i}><span aria-hidden="true">✦</span>{finding}</p>)}</div><div className="rl-eval-diagnosis-method">规则演示 · 非 Ragas / DeepEval 真实评分<br/>Question ID：{evaluation.questionId}<br/>发布版本：{evaluation.version===null?"未发布":`v${evaluation.version}`} · Revision：{evaluation.revision}<br/>演示数据未进行知识事实核验，需以未来 Judge 为准。</div></aside>
    </div>
    <div className="rl-eval-actions"><span>优化建议需要人工审核；本轮不会向服务器写入内容。</span><button type="button" className="rl-eval-outline" onClick={onBack}>返回详情</button><button type="button" className="rl-eval-primary" onClick={onOptimize}>生成优化方案（演示） →</button></div>
  </section>;
}
