import type {ReactNode} from "react";

/** Three-step flow shared with the reference question workbench. Step 3 marks a local preview adoption only, never a server write. */
export function WorkbenchSteps({step}:{step:1|2|3}){return <div className="rl-eval-steps" aria-label="优化流程">{["查看评估","确认优化","采用完成"].map((title,index)=><div key={title} className={index+1===step?"active":index+1<step?"finished":""}><span>{index+1<step?"✓":index+1}</span>{title}{index<2&&<i/>}</div>)}</div>;}
export function Score({value}:{value:number|null}){return <div className="rl-eval-score">{value===null?<strong className="rl-eval-not-rated">未评估</strong>:<><strong className={value>=80?"good":value>=50?"warn":"bad"}>{value}<small> / 100</small></strong><span className={`rl-eval-score-inline ${value>=80?"good":value>=50?"warn":"bad"}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="评分"><i style={{width:`${value}%`}}/></span></>}</div>;}
export function WorkbenchCard({title,children}:{title:string;children:ReactNode}){return <section className="rl-eval-card rl-eval-score-card"><h3>{title}</h3>{children}</section>;}
