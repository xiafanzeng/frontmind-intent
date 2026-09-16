import { useEffect, useState } from "react";
import { Button } from "@frontmind/module-ui/components/ui/button";
import type { IntentWorkspaceHost, IntentRestOperation } from "../module/client/host";
import type { QuestionsHost } from "../module/client/questions-host";
import type { ServicePortalQuestion } from "../module/contracts/questions";
import type { ResponseLogicRecordDto, SaveResponseLogicInput } from "../module/contracts/response-logic";
import { keywordCategoryKey, keywordCategoryTone } from "../module/contracts/keyword-categories";

type Snapshot<T> = { data?: T; isLoading: boolean; isFetching: boolean; isSuccess: boolean; isError: boolean; error?: Error };
function resource<T>(load: () => Promise<T>) {
 let state: Snapshot<T> = {isLoading:true,isFetching:false,isSuccess:false,isError:false};
 const listeners = new Set<() => void>(); let pending: Promise<{data?:T;error?:Error}> | undefined;
 const notify = () => listeners.forEach(fn => fn());
 const refetch = () => pending ??= (async () => {
  state={...state,isFetching:true};notify();
  try {const data=await load();state={data,isLoading:false,isFetching:false,isSuccess:true,isError:false};return {data};}
  catch(error) {const cause=error instanceof Error?error:new Error(String(error));state={...state,isLoading:false,isFetching:false,isSuccess:false,isError:true,error:cause};return {error:cause};}
  finally {pending=undefined;notify();}
 })();
 return {
  useQuery() {const [,setTick]=useState(0);useEffect(()=>{const fn=()=>setTick(n=>n+1);listeners.add(fn);void refetch();return ()=>{listeners.delete(fn);};},[]);return {...state,refetch};},
  refetch, invalidate: refetch,
  setData(_input:undefined,update:(current:T|undefined)=>T|undefined){state={...state,data:update(state.data)};notify();},
 };
}
async function request<T>(url:string, body?:unknown): Promise<T> {
 const response=await fetch(url,{credentials:"same-origin",method:body===undefined?"GET":"POST",headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 const payload=await response.json();
 if(!response.ok) throw Object.assign(new Error(payload?.error?.message || `请求失败（${response.status}）`),{code:payload?.error?.code});
 return payload as T;
}
export const exampleQuestion: ServicePortalQuestion = {
 id:"3e6c355c-926d-4c1b-b1c4-e541e0c9392d",contractId:null,quotaPeriodId:"",externalQuestionId:null,sourceQuestionId:null,category:"industry",question:"企业如何选择适合自己的知识管理系统？",intent:"了解选型条件和证据",intentRevision:1,intentConfirmedRevision:null,intentConfirmedAt:null,intentConfirmed:false,rationale:null,evidence:[],risks:[],source:"user",status:"selected",selectionApprovalStatus:"approved",selectionRequestedAt:null,selectionApprovedAt:null,locked:true,revision:1,
};
export function createStandaloneIntentAdapter(preview: boolean, workspaceId: string, notice: (message:string)=>void) {
 let previewQuestions=[{...exampleQuestion}]; let previewRecords:ResponseLogicRecordDto[]=[];
 const questions=resource(async()=>preview?{questions:previewQuestions}:request<{questions:ServicePortalQuestion[]}>("/api/intent/questions"));
 const records=resource(async()=>preview?{records:previewRecords}:request<{records:ResponseLogicRecordDto[]}>("/api/intent/response-logic"));
 const dashboard=resource(async()=>({revision:0,payload:{keywordTables:[]}}));
 const captureRestOperation=(signal?:AbortSignal|null):IntentRestOperation=>{const controller=new AbortController();if(signal)signal.addEventListener("abort",()=>controller.abort(),{once:true});return {signal:signal??controller.signal,assertActive(){if(signal?.aborted)throw new DOMException("操作已取消","AbortError");},fetch(input,init){if(preview)throw new Error("本地预览不调用供应商，请在开发域名执行真实任务");return fetch(input,{...init,credentials:"same-origin",signal:init?.signal??signal??controller.signal});}};};
 const responseHost: IntentWorkspaceHost = {
  captureRestOperation, useSearch:()=>window.location.search, activeEnterpriseProjectId:()=>workspaceId,
  categoryKey:keywordCategoryKey,categoryTone:keywordCategoryTone,
  trpc:{useUtils:()=>({workspace:{responseLogic:records}}),workspace:{responseLogic:{useQuery:()=>records.useQuery()},saveResponseLogic:{useMutation:options=>({async mutateAsync(input:SaveResponseLogicInput){if(preview)throw new Error("本地预览不保存真实数据");const result=await request<{record:ResponseLogicRecordDto}>("/api/intent/response-logic",input);options.onSuccess(result);void questions.invalidate();return result;}})}}},
  async createResponseLogicTask(messages,input,signal){
   if(preview)throw new Error("本地预览不调用供应商");
   const content=messages.flatMap(m=>typeof m.content==="string"?[{type:"input_text" as const,text:m.content}]:m.content);
   let response:Response;try {response=await captureRestOperation(signal).fetch(input.taskId?"/api/response-logic/turn":"/api/response-logic/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,userMessage:content.filter(c=>c.type==="input_text").map(c=>c.text).join("\n"),attachments:content.filter(c=>c.file_id).map(c=>({fileId:c.file_id,filename:c.filename,mimeType:c.mime_type}))})});}catch(error){throw Object.assign(new Error("启动结果暂时无法确认，正在恢复已有任务"),{code:"RESPONSE_LOGIC_START_OUTCOME_UNKNOWN",cause:error});}
   let payload:any;try{payload=await response.json();}catch{throw Object.assign(new Error("启动响应无效，请刷新恢复"),{code:"RESPONSE_LOGIC_START_RESPONSE_INVALID"});}
   if(!response.ok)throw Object.assign(new Error(payload.error?.message??"生成失败"),{code:payload.error?.code});
   const task=payload.task??payload;if(!task.id||!Number.isInteger(task.operationRevision))throw Object.assign(new Error("启动响应缺少任务轮次，请刷新恢复"),{code:"RESPONSE_LOGIC_START_RESPONSE_INVALID"});return task;
  },
  async uploadChatLocalAsset(file,onProgress,options){
   if(preview)throw new Error("本地预览不上传真实资料");
   const response=await captureRestOperation(options?.signal).fetch("/api/frontmind/v2/assets",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-FrontMind-Mime":options?.mimeType||file.type||"application/octet-stream","X-FrontMind-Filename":encodeURIComponent(options?.filename||file.name),"X-FrontMind-Size":String(file.size)},body:file});
   const payload=await response.json();if(!response.ok||!payload.localAssetId?.startsWith("asset_"))throw new Error(payload.error?.message??"上传失败");onProgress?.(100);return {fileId:payload.localAssetId,filename:payload.filename??file.name,sizeBytes:payload.sizeBytes,expiresAt:payload.expiresAt};
  },
  toast:{success:notice,error:notice},
  loadPreviewAdapter: () => import("./ResponseLogicPreview").then(value => value.responseLogicPreviewAdapter),
  Button,
  FilePreview:({file,className})=><a className={className} href={`/api/frontmind/v2/assets/${encodeURIComponent(file.fileId)}/content`} target="_blank" rel="noreferrer">{file.name}</a>,
  ImagePreview:({src,fileId,alt,className})=><img className={className} alt={alt} src={src??`/api/frontmind/v2/assets/${encodeURIComponent((fileId??""))}/content`}/>,
  BusinessExecutionActivity:({execution})=><details className="intent-execution"><summary>执行进度</summary><pre>{JSON.stringify(execution?.timeline??[],null,2)}</pre></details>,
 };
 const questionsHost: QuestionsHost={useBusinessWorkspace:()=>({task:{scopeKey:workspaceId}}),useBusinessWorkspaceSummary:()=>{},trpc:{useUtils:()=>({workspace:{questionPortfolio:questions,portal:questions,responseLogic:records}}),workspace:{questionPortfolio:{useQuery:()=>questions.useQuery()},dashboard:{useQuery:()=>dashboard.useQuery()},requestQuestionSelection:{useMutation:()=>({async mutateAsync(input){if(input.mode!=="direct")throw new Error("该入口由主工作台提供");if(preview){const question={...exampleQuestion,id:crypto.randomUUID(),question:input.question,category:input.category};previewQuestions=[...previewQuestions,question];return {question};}return request("/api/intent/questions",{question:input.question,category:input.category,clientRequestId:crypto.randomUUID()});}})},questionMaintenance:{execute:{useMutation:()=>({async mutateAsync(input){if(preview){const original=previewQuestions.find(q=>q.id===input.questionId);if(!original||original.revision!==input.expectedRevision)throw new Error("问题版本已变化，请刷新");previewQuestions=previewQuestions.filter(q=>q.id!==input.questionId);if(input.action==="modify")previewQuestions.push({...original,question:input.proposedQuestion!,revision:original.revision+1});return {questionId:input.questionId};}return request("/api/intent/questions/maintenance",input);}})}}}}};
 return {responseHost,questionsHost,questions};
}
