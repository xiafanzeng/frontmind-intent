import {useEffect,useMemo,useState} from "react";
import type {LogicField,LogicSections} from "./mock-evaluation.js";
import {createDemoOptimization,LOGIC_FIELDS} from "./mock-evaluation.js";
import {WorkbenchSteps} from "./workbench-parts.js";
import "./evaluation.css";

function allSelected():Record<LogicField,boolean>{return {concern:true,conclusion:true,facts:true,boundaries:true};}
function proposalText(logic:LogicSections,context:{question:string;intent:string}){return Object.fromEntries(createDemoOptimization(logic,context).sections.map(item=>[item.field,item.after])) as LogicSections;}

/**
 * Module-scoped memory cache for the in-progress optimization draft. It keeps the
 * draft across question/tab switches within the session (no silent loss) while
 * staying memory-only: a page refresh clears it and nothing ever reaches the
 * server, the stash queue or the real record draft.
 */
type OptimizationDraftState = {edited:LogicSections;accepted:Record<LogicField,boolean>;adopted:boolean};
const optimizationDraftCache = new Map<string,OptimizationDraftState>();


/** No save, business requests, persistence queue, or model invocation. Adoption only flips local preview state. */
export function ResponseLogicOptimizationWorkflow({question,intent,contextKey,logic,onBack}:{question:string;intent:string;contextKey:string;logic:LogicSections;onBack:()=>void}){
  const proposal=useMemo(()=>createDemoOptimization(logic,{question,intent}),[logic,question,intent]);
  const key=contextKey;
  const restored=optimizationDraftCache.get(key);
  const [edited,setEdited]=useState<LogicSections>(()=>restored?.edited ?? proposalText(logic,{question,intent}));
  const [accepted,setAccepted]=useState<Record<LogicField,boolean>>(()=>restored?.accepted ?? allSelected());
  const [adopted,setAdopted]=useState<boolean>(()=>restored?.adopted ?? false);
  const [selected,setSelected]=useState<LogicField>("concern");
  const [compare,setCompare]=useState(false);
  const [revision,setRevision]=useState(0);
  const dirty=!adopted&&proposal.sections.some(item=>edited[item.field]!==item.after||!accepted[item.field]);
  const count=LOGIC_FIELDS.filter(item=>accepted[item.field]).length;
  useEffect(()=>{optimizationDraftCache.set(key,{edited,accepted,adopted});},[key,edited,accepted,adopted]);
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
  const permitLeave=()=>!dirty||window.confirm("当前优化方案有未保存的修改，离开后将丢失。确认离开？");
  const reset=()=>{if(!permitLeave())return;setEdited(proposalText(logic,{question,intent}));setAccepted(allSelected());setAdopted(false);setCompare(false);setRevision(n=>n+1);};
  const patchDraft=(next:Partial<OptimizationDraftState>)=>{if(next.edited!==undefined)setEdited(next.edited);if(next.accepted!==undefined)setAccepted(next.accepted);if(next.adopted!==undefined)setAdopted(next.adopted);};
  const active=proposal.sections.find(item=>item.field===selected)!;
  const displayAfter=(field:LogicField)=>accepted[field]?edited[field]:logic[field];
  return <section className="rl-eval-root" aria-label="优化应答逻辑">
    <div className="rl-eval-back"><button type="button" className="rl-eval-back-button" onClick={()=>{if(permitLeave())onBack();}}>← 返回评估详情</button></div>
    <header className="rl-eval-heading"><div><h2>{adopted?"优化方案已采用（本地预览）":"确认优化方案"}</h2><p>{question} · 选择需要采纳的动作，查看并编辑具体内容变更；采用仅更新本地预览状态。</p></div></header>
    <WorkbenchSteps step={adopted?3:2}/>
    {adopted?<div className="rl-opt-adopted rl-eval-card" role="status">
        <h3>已采用为本地预览版本 <span className="rl-eval-tag supported">本地预览 · 未保存到服务器</span></h3>
        <p>以下为采用后的四部分预览内容（未采纳部分保留原文）。当前页面仍在使用服务器上的正式应答逻辑；此状态仅存在于当前浏览器会话，刷新后清空。</p>
        <div className="rl-opt-compare">{proposal.sections.map(item=><section className="rl-opt-compare-row" key={item.field}><h3>{item.label}<span className={`rl-eval-tag ${accepted[item.field]?"supported":"partial"}`}>{accepted[item.field]?"已采用":"未采纳（保留原文）"}</span></h3><div className="rl-opt-compare-pair"><div className="rl-opt-before"><b>原文</b><p>{item.before||"（暂无内容）"}</p></div><div className="rl-opt-after"><b>采用后（本地预览）</b><p>{displayAfter(item.field)||"（暂无内容）"}</p></div></div></section>)}</div>
        <div className="rl-opt-adopted-actions"><button type="button" className="rl-eval-outline" onClick={()=>setAdopted(false)}>撤销采用并继续编辑</button><button type="button" className="rl-eval-primary" onClick={()=>{if(permitLeave())onBack();}}>返回评估详情</button></div>
      </div>
    :<><div className="rl-opt-toolbar"><span className="rl-eval-tag partial">优化建议为本地启发式生成；采用后建议重新进行 LLM 语义评估验证</span><button type="button" className="rl-eval-outline" onClick={reset}>重新生成建议</button><button type="button" className="rl-eval-outline" onClick={()=>setCompare(v=>!v)}>{compare?"返回方案编辑":"查看前后对比"}</button></div>
    {compare?<div className="rl-opt-compare" aria-label="优化前后对比">{proposal.sections.map(item=><section className="rl-opt-compare-row" key={item.field}><h3>{item.label}<span className={`rl-eval-tag ${accepted[item.field]?"supported":"partial"}`}>{accepted[item.field]?"已选择":"本项未采纳"}</span></h3><div className="rl-opt-compare-pair"><div className="rl-opt-before"><b>修改前</b><p>{item.before||"（暂无内容）"}</p></div><div className="rl-opt-after"><b>修改后（本地预览）</b><p>{displayAfter(item.field)||"（暂无内容）"}</p></div></div><p className="rl-opt-compare-reason">{item.reason}</p><p className="rl-eval-evidence">对应解决：{item.resolvedIssues.join("；")||"无"} · 仍需解决：{item.remainingIssues.join("；")}</p></section>)}</div>
      :<div className="rl-opt-layout">
        <nav className="rl-opt-menu rl-eval-card" aria-label="优化建议清单">
          <h3>优化建议 <small>选择 {count} / 4 项</small></h3>
          {proposal.sections.map(item=><section className={`rl-opt-task ${accepted[item.field]?"selected":""} ${selected===item.field?"is-active":""}`} key={item.field}>
            <label><input type="checkbox" checked={accepted[item.field]} aria-label={`采纳${item.label}`} onChange={event=>patchDraft({accepted:{...accepted,[item.field]:event.target.checked}})}/><b>{item.label}</b><span className="rl-eval-tag">建议</span></label>
            <p>{item.reason}</p><div className="rl-opt-task-actions"><button type="button" onClick={()=>setSelected(item.field)}>查看并编辑</button><button type="button" onClick={()=>patchDraft({accepted:{...accepted,[item.field]:false}})}>不采纳</button></div>
          </section>)}
        </nav>
        <section className="rl-opt-editor rl-eval-card"><h3>{active.label}<span className="rl-eval-tag">{accepted[selected]?"可编辑":"未采纳"}</span></h3>
          <div className="rl-opt-editor-body"><p className="rl-opt-evidence">{question} · {active.reason}</p>
            <div className="rl-opt-before"><b>修改前</b><p>{active.before||"（暂无内容）"}</p></div>
            <div className="rl-opt-after"><label htmlFor={`rl-opt-edit-${selected}`}>修改后（本地草稿）</label><textarea id={`rl-opt-edit-${selected}`} aria-label={`${active.label}修改后`} rows={10} disabled={!accepted[selected]} value={edited[selected]} onChange={event=>patchDraft({edited:{...edited,[selected]:event.target.value}})}/></div>
            {!accepted[selected]&&<p className="rl-opt-unselected-note">此项未采纳，采用后将保留原文。勾选后可以继续编辑。</p>}
            <div className="rl-opt-issues"><b>对应解决</b><ul>{active.resolvedIssues.map((issue,i)=><li key={i}>{issue}</li>)}</ul><b>仍需解决</b><ul>{active.remainingIssues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>
          </div>
        </section>
      </div>}
    <div className="rl-eval-actions"><span>已选 <strong>{count}</strong> 项 · {dirty?"方案有未保存的修改，离开时需要确认":adopted?"已采用（本地预览）":"本地预览状态，刷新即清空"}{revision>0?` · 重新生成 ${revision} 次`:""}</span><div className="rl-eval-action-buttons"><button type="button" className="rl-eval-outline" onClick={()=>{if(permitLeave())onBack();}}>取消修改</button><button type="button" className="rl-eval-primary" disabled={count===0} onClick={()=>setAdopted(true)}>采用（本地预览）</button></div></div></>}
  </section>;
}
