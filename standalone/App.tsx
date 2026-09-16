import {useEffect,useMemo,useState} from "react";
import ModuleWorkspace, {type ModuleContext} from "../module/client/ModuleWorkspace";
import {createStandaloneIntentAdapter} from "./standalone-adapter";
export default function App({preview=false}: {preview?:boolean}) {
 const [context,setContext]=useState<ModuleContext|null>(preview?{module:"intent",workspace:{id:"local-preview",ownerUserId:0},marketEdition:"cn",capabilities:["intent"]}:null);
 const [error,setError]=useState("");
 useEffect(()=>{if(preview)return;const controller=new AbortController();void fetch("/api/module/context",{credentials:"same-origin",signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("开发门禁验证失败，请重新打开页面");return response.json();}).then(value=>{if(value.module!=="intent"||!value.workspace?.id)throw new Error("模块运行上下文无效");setContext(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});return ()=>controller.abort();},[preview]);
 if(error)return <main className="intent-standalone"><h1>意图优化</h1><p role="alert">{error}</p><button onClick={()=>location.reload()}>重新加载</button></main>;
 if(!context)return <main className="intent-standalone" role="status">正在进入意图优化…</main>;
 return <IntentWorkspaceContent key={context.workspace.id} preview={preview} context={context}/>;
}
function IntentWorkspaceContent({preview,context}:{preview:boolean;context:ModuleContext}) {
 const [notice,setNotice]=useState("");
 const adapter=useMemo(()=>createStandaloneIntentAdapter(preview,context.workspace.id,setNotice),[preview,context.workspace.id]);
 return <ModuleWorkspace preview={preview} context={context} adapter={adapter} notice={notice} onDismissNotice={()=>setNotice("")} />;
}
