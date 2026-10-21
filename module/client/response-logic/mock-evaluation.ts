/** Only presentation demo. No network, persistence, Agent or factual evaluation. */
export type LogicField = "concern" | "conclusion" | "facts" | "boundaries";
export type LogicSections = Record<LogicField, string>;
export const LOGIC_FIELDS: Array<{ field: LogicField; title: string }> = [
  {field:"concern",title:"用户真实关心"}, {field:"conclusion",title:"核心结论与执行口径"},
  {field:"facts",title:"企业材料与官方依据"}, {field:"boundaries",title:"回答边界与禁止表达"},
];
export type DemoEvaluation = ReturnType<typeof createDemoEvaluation>;
export type DemoOptimization = ReturnType<typeof createDemoOptimization>;
const score = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export const fingerprintLogic = (logic: LogicSections) => JSON.stringify(LOGIC_FIELDS.map(({field})=>logic[field]));
export function createDemoEvaluation(input:{questionId:string;question:string;intent:string;version:number|null;revision:number;logic:LogicSections}) {
  const {logic}=input;
  const coverage = [
    ...LOGIC_FIELDS.slice(0,2).map(({field,title})=>({key:field,label:title,text:logic[field]})),
    {key:"supporting_facts",label:"Supporting Facts",text:logic.facts},
    {key:"evidence",label:"Evidence",text:logic.facts},
    {key:"boundary_caveat",label:"Boundary / Caveat",text:logic.boundaries},
  ].map(({key,label,text})=>{
    const status = !text.trim() ? "missing" as const : text.trim().length < 45 ? "partial" as const : "covered" as const;
    return {key,label,status,reason:status==="missing"?"没有填写对应内容":status==="partial"?"内容存在，但仍较简略":"包含部分文字；真实充分性尚未核实",suggestion:"结合当前 Question 与知识库证据进一步完善"};
  });
  const subMetrics=[
    {key:"content_specificity",label:"Content Specificity",score:score((logic.concern.length+logic.conclusion.length)/3),reason:"基于文本长度的演示占位，非语义判定",suggestion:"指出具体应回答什么"},
    {key:"evidence_guidance",label:"Evidence Guidance",score:score(logic.facts.length/2),reason:"基于依据栏目文本长度的演示占位",suggestion:"列出可核验的具体资料与来源"},
    {key:"structure_guidance",label:"Structure Guidance",score:score(logic.conclusion.length/2),reason:"仅用于模拟结构引导评分显示",suggestion:"明确推荐的回答组织顺序"},
  ];
  return {kind:"rules-demo" as const, ...input, sourceFingerprint:fingerprintLogic(logic),dimensions:{
    relevance:{score:score(20+(logic.concern.length+logic.conclusion.length)/5),reason:"演示占位分数，未进行 Question/Intent 的语义相关性评估",issues:["尚未运行相关性 Judge，无法证明是否真正答到点上"],suggestions:["后续使用 Ragas / DeepEval 评估与原问题的相关性"]},
    completeness:{score:score(coverage.reduce((sum,v)=>sum+(v.status==="covered"?100:v.status==="partial"?50:0),0)/5),reason:"仅根据文本存在及长度模拟覆盖程度",coverage},
    actionability:{score:score(subMetrics.reduce((sum,v)=>sum+v.score,0)/3),reason:"三个演示子项的均值，不代表真实可执行性",subMetrics},
    boundaryRisk:{score:null as number|null,judgeRan:false,note:"尚未运行风险识别 Judge，风险数量未知，不能默认满分。",risks:[{kind:"风险检查占位",dimension:"missing_boundary" as const,controlled:Boolean(logic.boundaries.trim()),guidance:"核实无依据排名、绝对化效果承诺及未经核实的比较"}]},
  }};
}
export function createDemoOptimization(logic:LogicSections) {
  const guidelines:LogicSections={
    concern:"请进一步明确用户真实诉求及决策疑问。",
    conclusion:"请先回应核心问题，再按证据和适用条件展开。",
    facts:"请指明知识库中可核验的材料和证据位置，勿编造事实。",
    boundaries:"请明确禁止无依据排名、保证效果、未经核实的比较和绝对化表述。",
  };
  return {kind:"demo-optimization" as const,sections:LOGIC_FIELDS.map(({field,title})=>({field,label:title,before:logic[field],after:[logic[field].trim(),`【演示优化提示】${guidelines[field]}`].filter(Boolean).join("\n\n"),reason:"规则演示建议，非真实 Agent 输出",resolvedIssues:[] as string[],remainingIssues:["仍需人工核对，未执行真实评估"]}))};
}
