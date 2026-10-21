import {useEffect,useMemo,useState} from "react";
import type {DemoEvaluation,LogicField,LogicSections} from "./mock-evaluation.js";
import {createDemoOptimization,LOGIC_FIELDS} from "./mock-evaluation.js";
import {DemoBanner,WorkbenchSteps} from "./workbench-parts.js";
import "./evaluation.css";

function allSelected():Record<LogicField,boolean>{return {concern:true,conclusion:true,facts:true,boundaries:true};}
function proposalText(logic:LogicSections){return Object.fromEntries(createDemoOptimization(logic).sections.map(item=>[item.field,item.after])) as LogicSections;}
/** No save, business requests, persistence queue, or model invocation. */
export function ResponseLogicOptimizationWorkflow({evaluation,logic,onBack}:{evaluation:DemoEvaluation;logic:LogicSections;onBack:()=>void}){
  const proposal=useMemo(()=>createDemoOptimization(logic),[logic]);
  const [edited,setEdited]=useState<LogicSections>(()=>proposalText(logic));
  const [accepted,setAccepted]=useState<Record<LogicField,boolean>>(allSelected);
  const [selected,setSelected]=useState<LogicField>("concern");
  const [compare,setCompare]=useState(false);
  const [revision,setRevision]=useState(0);
  const dirty=proposal.sections.some(item=>edited[item.field]!==item.after||!accepted[item.field]);
  const count=LOGIC_FIELDS.filter(item=>accepted[item.field]).length;
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
  const permitLeave=()=>!dirty||window.confirm("当前演示优化方案有未保存的修改，离开后将丢失。确认离开？");
  const reset=()=>{if(!permitLeave())return;setEdited(proposalText(logic));setAccepted(allSelected());setCompare(false);setRevision(n=>n+1);};
  const active=proposal.sections.find(item=>item.field===selected)!;
  const displayAfter=(field:LogicField)=>accepted[field]?edited[field]:logic[field];
  return <section className="rl-eval-root" aria-label="演示优化应答逻辑">
    <DemoBanner/>
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={()=>{if(permitLeave())onBack();}}>← 返回评估详情</button></div>
    <header className="rl-eval-heading"><div><h2>确认优化方案</h2><p>{evaluation.question} · 选择需要采纳的动作，查看并编辑具体内容变更。</p></div><span className="rl-eval-tag">演示优化</span></header>
    <WorkbenchSteps step={2}/>
    <div className="rl-opt-toolbar"><span className="rl-eval-tag partial">演示预估，非真实评估</span><button type="button" className="rl-eval-outline" onClick={reset}>重新生成演示建议</button><button type="button" className="rl-eval-outline" onClick={()=>setCompare(v=>!v)}>{compare?"返回方案编辑":"查看前后对比"}</button></div>
    {compare?<div className="rl-opt-compare" aria-label="优化前后对比">{proposal.sections.map(item=><section className="rl-opt-compare-row" key={item.field}><h3>{item.label}<span className={`rl-eval-tag ${accepted[item.field]?"supported":"partial"}`}>{accepted[item.field]?"演示已选择":"本项未采纳"}</span></h3><div className="rl-opt-compare-pair"><div className="rl-opt-before"><b>修改前</b><p>{item.before||"（暂无内容）"}</p></div><div className="rl-opt-after"><b>修改后（本地预览）</b><p>{displayAfter(item.field)||"（暂无内容）"}</p></div></div><p className="rl-opt-compare-reason">{item.reason}</p></section>)}</div>:
      <div className="rl-opt-layout">
        <nav className="rl-opt-menu rl-eval-card" aria-label="优化建议清单">
          <h3>优化建议 <small>选择 {count} / 4 项</small></h3>
          {proposal.sections.map((item,i)=><section className={`rl-opt-task ${accepted[item.field]?"selected":""} ${selected===item.field?"is-active":""}`} key={item.field}>
            <label><input type="checkbox" checked={accepted[item.field]} aria-label={`采纳${item.label}`} onChange={event=>setAccepted(current=>({...current,[item.field]:event.target.checked}))}/><b>{item.label}</b><span className="rl-eval-tag">演示建议</span></label>
            <p>{item.reason}</p><div className="rl-opt-task-actions"><button type="button" onClick={()=>setSelected(item.field)}>查看并编辑</button><button type="button" onClick={()=>setAccepted(current=>({...current,[item.field]:false}))}>不采纳</button></div>
          </section>)}
        </nav>
        <section className="rl-opt-editor rl-eval-card"><h3>{active.label}<span className="rl-eval-tag">{accepted[selected]?"可编辑":"未采纳"}</span></h3>
          <div className="rl-opt-editor-body"><p className="rl-opt-evidence">{evaluation.question} · {active.reason}</p>
            <div className="rl-opt-before"><b>修改前</b><p>{active.before||"（暂无内容）"}</p></div>
            <div className="rl-opt-after"><label htmlFor={`rl-opt-edit-${selected}`}>修改后（本地演示草稿）</label><textarea id={`rl-opt-edit-${selected}`} aria-label={`${active.label}修改后`} rows={10} disabled={!accepted[selected]} value={edited[selected]} onChange={event=>setEdited(previous=>({...previous,[selected]:event.target.value}))}/></div>
            {!accepted[selected]&&<p className="rl-opt-unselected-note">此项未采纳，前后对比将保留原文。勾选后可以继续编辑。</p>}
            <div className="rl-opt-issues"><b>效果说明</b><p>本轮仅预览结构化调整，没有运行真实 Judge，无法断言问题已经解决。</p><b>仍需解决</b><ul>{active.remainingIssues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>
          </div>
        </section>
      </div>}
    <div className="rl-eval-actions"><span>已选 <strong>{count}</strong> 项 · {dirty?"演示草稿已修改，离开时需要确认":"仅组件内存预览，刷新即清空"}{revision>0?` · 重新生成 ${revision} 次`:""}</span><div className="rl-eval-action-buttons"><button type="button" className="rl-eval-outline" onClick={()=>{if(permitLeave())onBack();}}>取消修改</button><button type="button" className="rl-eval-primary" disabled title="需后端支持后启用">采用并保存（需后端支持后启用）</button></div></div>
  </section>;
}
