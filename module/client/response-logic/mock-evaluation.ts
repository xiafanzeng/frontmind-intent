/**
 * Frontend sample data for the response-logic evaluation preview.
 * Pure functions of the current question/intent/logic text: no network,
 * no persistence, no Agent and no factual judging. Scores quote and inspect
 * the actual section text so the preview stays coherent per question.
 */
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

const sentences = (text: string) => text.split(/[。！？\n]/).map(s=>s.trim()).filter(Boolean);
const lines = (text: string) => text.split("\n").map(s=>s.trim()).filter(Boolean);
const terms = (question: string) => question.replace(/[？?！!。，,\s]/g,"").split(/[：:；;、]/).flatMap(part=>part.length>=2?[part]:[]).slice(0,6);
const RISKY = [
  {pattern:/第[一二三四五六七八九十\d]+|排名第一|行业第一/g,kind:"无依据排名",guidance:"排名表述必须同时给出样本范围、评价维度与信息时间，否则删除或改为区间描述。"},
  {pattern:/唯一|独家|绝对领先|绝对优势/g,kind:"绝对化表达",guidance:"改为可核验的限定表述，例如「在 XX 样本与时间范围内」+ 可追溯来源。"},
  {pattern:/保证|承诺.{0,4}(收录|效果|成功)|百分百|100%/g,kind:"保证性承诺",guidance:"效果类承诺必须注明适用前提，并以最终确认文件为准。"},
  {pattern:/(远超|吊打|碾压).{0,8}(竞品|同行|对手)/g,kind:"未经核实的比较",guidance:"竞品比较须并列比较条件与数据来源；无法核实时改为客观差异描述。"},
];

export function createDemoEvaluation(input:{questionId:string;question:string;intent:string;version:number|null;revision:number;logic:LogicSections}) {
  const {logic,question,intent}=input;
  const questionTerms=terms(question);
  const conclusionSentences=sentences(logic.conclusion);
  const factLines=lines(logic.facts);
  const matched=questionTerms.filter(term=>logic.conclusion.includes(term)||logic.concern.includes(term));
  const missing=questionTerms.filter(term=>!matched.includes(term));
  const evidenceMarkers=["知识库","来源","文档","官网","授权","依据","可追溯","记录"].filter(marker=>logic.facts.includes(marker));
  const numbered=/(?:(?:^|\n)\s*(?:\d+[.、）)]|[①②③④⑤]))/.test(logic.conclusion);
  const structureMarkers=["口径","首句","分条","适用条件","顺序","先","再"].filter(m=>logic.conclusion.includes(m));

  const coverage=[
    {field:"concern" as const,label:"用户真实关心",text:logic.concern,
      requirement:"完整转述用户的决策疑问与在意点",
      sufficient:()=>logic.concern.trim().length>=40,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：应答逻辑未回应用户视角。"
        :status==="partial"?`已有 ${len} 字，但尚未完整覆盖“决策疑问 + 在意点”的完整表述（建议 ≥40 字并含问句或明确的在意点清单）。`
        :`共 ${len} 字，包含明确的用户视角表述，覆盖情况良好。`},
    {field:"conclusion" as const,label:"核心结论 / 执行口径",text:logic.conclusion,
      requirement:"直接回应问题并给出可执行口径",
      sufficient:()=>conclusionSentences.length>=2&&logic.conclusion.length>=60,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：缺少回答的主结论。"
        :status==="partial"?`共 ${len} 字 / ${conclusionSentences.length} 句，尚未形成“结论 + 执行口径”的完整结构（建议 ≥2 句且 ≥60 字，最好含编号步骤）。`
        :`共 ${len} 字 / ${conclusionSentences.length} 句，结构上已包含结论与执行口径。`},
    {field:"facts" as const,label:"企业材料 / 官方依据",text:logic.facts,
      requirement:"逐条列出可核验的企业事实并绑定来源",
      sufficient:()=>factLines.length>=3&&evidenceMarkers.length>=2,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：回答将缺少事实支撑。"
        :status==="partial"?`已有 ${factLines.length} 行事实${evidenceMarkers.length?`，来源标记 ${evidenceMarkers.length} 处（${evidenceMarkers.slice(0,3).join("、")}）`:"，但未检出可核验的来源标记"}；建议 ≥3 行事实且每行绑定来源。`
        :`${factLines.length} 行事实、来源标记 ${evidenceMarkers.length} 处，可核验性较好。`},
    {field:"boundaries" as const,label:"回答边界 / 禁止表达",text:logic.boundaries,
      requirement:"写明禁止表达与适用前提",
      sufficient:()=>logic.boundaries.trim().length>=50,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：未设置回答边界，风险表述无约束。"
        :status==="partial"?`已有 ${len} 字，边界约束较简略（建议 ≥50 字，逐条列出禁止表达与适用前提）。`
        :`共 ${len} 字，已逐条写明禁止表达与适用前提。`},
  ].map(({field,label,text,requirement,sufficient,basis})=>{
    const len=text.trim().length;
    const status=!text.trim()?"missing"as const:sufficient()?"covered"as const:"partial"as const;
    const statusText=status==="covered"?"完整":status==="partial"?"部分覆盖":"缺失";
    const situation=status==="missing"?`「${label}」缺失`:`「${label}」${statusText}`;
    const suggestion=status==="missing"?`补写「${label}」：${requirement}。`
      :status==="partial"?`继续完善「${label}」：${requirement}。`
      :`「${label}」保持现状；接入真实 Judge 后再校验语义充分性。`;
    return {field,label,status,statusText,situation,basis:basis(status,len),requirement,suggestion};
  });

  const subMetrics=[
    {key:"content_specificity",label:"Content Specificity（内容具体度）",
      gained:numbered?30:logic.conclusion.length>=120?15:0,base:score(logic.conclusion.length/4),
      reason:numbered?"结论包含编号步骤，动作可执行；结合篇幅给出具体度分。":"结论未采用编号步骤，具体动作与判断条件尚不够显式。",
      suggestion:numbered?"将每个编号步骤补上「判断条件 + 动作 + 依据」三要素。":"将执行口径改写为编号步骤，每步给出可操作动作与判断条件。"},
    {key:"evidence_guidance",label:"Evidence Guidance（证据指引）",
      gained:evidenceMarkers.length>=2?25:evidenceMarkers.length===1?10:0,base:score(logic.facts.length/3),
      reason:evidenceMarkers.length?`依据栏出现「${evidenceMarkers.join("、")}」等来源标记。`:"依据栏未出现可核验的来源标记。",
      suggestion:"为每条事实标注来源（知识库文档/官网/授权文件/项目记录），便于逐项回溯。"},
    {key:"structure_guidance",label:"Structure Guidance（结构引导）",
      gained:structureMarkers.length>=3?25:structureMarkers.length?10:0,base:score(structureMarkers.length*15),
      reason:structureMarkers.length?`结论中有结构信号：${structureMarkers.slice(0,4).join("、")}。`:"结论缺少「首句回应—分条展开—适用条件收束」的结构信号。",
      suggestion:"按「首句回应决策重点 → 3-5 项事实展开 → 适用条件与限制收束」组织结论。"},
  ].map(({gained,base,...rest})=>({...rest,score:score(base+gained)}));

  const riskyHits=RISKY.flatMap(({pattern,kind,guidance})=>{
    const hits=[...logic.conclusion.matchAll(pattern),...logic.facts.matchAll(pattern)].slice(0,2);
    return hits.map(match=>({kind,dimension:"missing_facts"as const,excerpt:match[0].length?match.input!.slice(Math.max(0,match.index!-12),match.index!+match[0].length+12):"",controlled:false,guidance}));
  });
  const boundaryRules=lines(logic.boundaries);
  const controlledKinds=RISKY.filter(({pattern})=>boundaryRules.some(rule=>pattern.test(rule))).map(({kind,guidance})=>({kind,dimension:"missing_boundary"as const,excerpt:"",controlled:true,guidance:`已在「回答边界」中设置对应约束：${guidance}`}));
  const riskList=RISKY.map(({pattern,kind,guidance})=>{
    const hits=riskyHits.filter(hit=>hit.kind===kind);
    const ruleMatched=boundaryRules.some(rule=>pattern.test(rule));
    const status=hits.length?(ruleMatched?"已识别并受控":"已识别未设边界"):ruleMatched?"已设置边界约束":"未检出相关表述";
    return {kind,dimension:ruleMatched?"missing_boundary"as const:"missing_facts"as const,
      excerpt:hits[0]?.excerpt??"",controlled:ruleMatched,status,
      guidance:hits.length?guidance:ruleMatched?`回答边界已覆盖该类风险；${guidance}`:`未在正文检出「${kind}」表述；建议在回答边界中预先设置对应约束。`};
  });
  const uncontrolled=riskyHits.filter(hit=>!riskList.some(r=>r.kind===hit.kind&&r.controlled));
  const boundaryEmpty=boundaryRules.length===0;
  const unboundedHits=riskList.filter(r=>r.status==="已识别未设边界").length;
  const riskScore=score(Math.max(30,100-unboundedHits*22-(boundaryEmpty?18:0)-riskList.filter(r=>r.status==="未检出相关表述").length*4));

  return {kind:"sample-data" as const,...input,sourceFingerprint:fingerprintLogic(logic),dimensions:{
    relevance:{score:score(45+matched.length*(55/Math.max(1,questionTerms.length))+(/样本|依据|来源/.test(logic.conclusion)?8:0)),
      reason:matched.length===questionTerms.length
        ?`结论与「用户真实关心」覆盖了问题的全部关键词（${matched.slice(0,3).join("、")}），首句能直接回应“${question}”。`
        :`结论与关心点覆盖了「${matched.slice(0,3).join("、")||"无"}」${missing.length?`，但未显式回应「${missing.slice(0,2).join("、")}」`:""}；与意图（${intent.slice(0,24)||"未提供"}）的对应关系需进一步显式化。`,
      issues:missing.slice(0,2).map(term=>`核心结论未显式回应问题关键词「${term}」，读者需要自行推断关联。`).concat(matched.length===0?["未检测到任何问题关键词进入结论，存在偏题风险。"]:[]),
      suggestions:["在结论首句直接回应问题主语与决策动作。","将「用户真实关心」中的在意点逐条映射到执行口径，避免答非所问。"],
      method:"关键词覆盖启发式（前端示例，非 Ragas / DeepEval 语义评估）"},
    completeness:{score:score(coverage.reduce((sum,v)=>sum+(v.status==="covered"?100:v.status==="partial"?50:0),0)/4),
      reason:`四项必要内容中 ${coverage.filter(v=>v.status==="covered").length} 项完整、${coverage.filter(v=>v.status==="partial").length} 项部分覆盖、${coverage.filter(v=>v.status==="missing").length} 项缺失；按 100/50/0 折算均值。`,coverage},
    actionability:{score:score(subMetrics.reduce((sum,v)=>sum+v.score,0)/3),
      reason:`三项子维度（具体度 ${subMetrics[0].score} / 证据指引 ${subMetrics[1].score} / 结构引导 ${subMetrics[2].score}）取平均；子项均针对文本形态判定。`,subMetrics},
    boundaryRisk:{score:riskScore,
      note:`四类标准风险逐项核对：${riskList.filter(r=>r.status==="已识别并受控"||r.status==="已设置边界约束").length} 项受控，${riskList.filter(r=>r.status==="已识别未设边界").length} 项已识别但未设边界，${riskList.filter(r=>r.status==="未检出相关表述").length} 项未检出相关表述。`,
      risks:riskList,
      method:"风险词法扫描（前端示例）：绝对化/排名/承诺/比较类表述 × 回答边界对照"},
  }};
}

export function createDemoOptimization(logic:LogicSections,context?:{question:string;intent:string}) {
  const questionTerms=context?terms(context.question):[];
  const intent=context?.intent??"";
  const sections=LOGIC_FIELDS.map(({field,title})=>{
    const before=logic[field];
    let after=before.trim();let reason="";let resolvedIssues:string[]=[];const remainingIssues:string[]=[];
    if(field==="concern"){
      after=[after||"（原文为空）",`决策场景：${intent||"围绕当前问题的决策疑问"}`,`在意点：\n1. 选型条件与适用范围\n2. 评价维度是否可核验\n3. 结论的适用前提与限制`].join("\n\n");
      reason="将意图转写为具体决策场景与在意点清单，使后续结论逐条对应（改善 Answer Relevance 的关键词覆盖）。";
      resolvedIssues=["用户在意点未显式列出","结论与「用户真实关心」的映射缺失"];
      remainingIssues.push("在意点需与真实用户反馈核对后定稿。");
    }else if(field==="conclusion"){
      after=[after||"（原文为空）",`执行口径（建议采用编号步骤）：\n1. 首句直接回应问题主语与决策动作${questionTerms.length?`（${questionTerms.slice(0,2).join("、")}）`:""}；\n2. 按样本范围、评价维度、信息时间三项标准核对外部榜单；\n3. 给出分类型候选清单与选择建议；\n4. 以适用条件与限制收束，允许读者回溯依据。`].join("\n\n");
      reason="把执行口径改写为编号步骤，补齐「判断条件 + 动作 + 依据」要素（改善 Actionability 的内容具体度与结构引导）。";
      resolvedIssues=["结论缺少编号步骤","结构信号不足"];
      remainingIssues.push("步骤中的判断阈值需结合业务口径确认。");
    }else if(field==="facts"){
      after=[after||"（原文为空）",`来源绑定建议：\n- 每条事实行末标注（知识库文档 / 官网 / 授权文件 / 项目记录）；\n- 无法绑定来源的表述移入「回答边界」作为限制说明。`].join("\n\n");
      reason="为事实清单增加逐条来源绑定规则，补齐 Evidence 覆盖项（改善 Completeness 的证据与来源子项）。";
      resolvedIssues=["证据缺少来源标记"];
      remainingIssues.push("来源清单需与知识库实际文档核对。");
    }else{
      after=[after||"（原文为空）",`禁止与谨慎表达清单：\n1. 无依据排名：仅在有样本范围、评价维度与信息时间时使用排名表述；\n2. 绝对化承诺：不用「唯一/绝对领先/保证收录」类表述；\n3. 未经核实的比较：竞品对比必须并列比较条件与数据来源；\n4. 价格与周期：注明适用前提，以最终确认文件为准。`].join("\n\n");
      reason="将边界整理为逐条禁止/谨慎清单，与风险扫描的四类风险一一对应（改善 Boundary / Risk Control 的未受控项）。";
      resolvedIssues=["未设置回答边界（部分风险无对应约束）"];
      remainingIssues.push("清单需法务/业务复核后作为正式口径。");
    }
    return {field,label:title,before,after,reason,resolvedIssues,remainingIssues};
  });
  return {kind:"sample-optimization" as const,sections};
}

export type DiagnosisSeverity = "improve" | "risk";
export type DiagnosisDimension = "relevance" | "completeness" | "actionability" | "boundaryRisk";
export type DiagnosisItem = {
  id: string;
  dimension: DiagnosisDimension;
  dimensionLabel: string;
  severity: DiagnosisSeverity;
  title: string;
  summary: string;
  reason: string;
  excerpt: string;
  targetField: LogicField;
  targetLabel: string;
  suggestion: string;
};
const DIMENSION_LABELS: Record<DiagnosisDimension, string> = {
  relevance: "Answer Relevance", completeness: "Completeness",
  actionability: "Actionability", boundaryRisk: "Boundary / Risk Control",
};
/**
 * Derive the actionable diagnosis list from one demo evaluation. Pure and
 * deterministic; each item keeps a stable id plus a target logic field so the
 * UI can locate the exact editor section without title matching.
 */
export function buildDiagnosis(evaluation: DemoEvaluation): DiagnosisItem[] {
  const { dimensions, logic, question } = evaluation;
  const items: DiagnosisItem[] = [];
  const qTerms = terms(question);
  const matched = qTerms.filter(term => logic.conclusion.includes(term) || logic.concern.includes(term));
  const missingTerms = qTerms.filter(term => !matched.includes(term));
  if (missingTerms.length) {
    items.push({
      id: "dx-relevance-conclusion", dimension: "relevance", dimensionLabel: DIMENSION_LABELS.relevance,
      severity: "improve", title: "核心结论未直接回应问题",
      summary: `问题关键词「${missingTerms.slice(0, 2).join("、")}」没有进入核心结论。`,
      reason: `在「核心结论/执行口径」与「用户真实关心」中检索问题「${question}」的关键词（${qTerms.slice(0, 3).join("、") || "无"}），其中「${missingTerms.join("、")}」未出现，读者需要自行推断回答与问题的关联，存在答非所问的观感。`,
      excerpt: logic.conclusion.slice(0, 80),
      targetField: "conclusion", targetLabel: "核心结论 / 执行口径",
      suggestion: "在结论首句直接回应问题主语与决策动作，并让每个问题关键词都能在执行口径中找到对应条目。",
    });
  }
  for (const item of dimensions.completeness.coverage) {
    if (item.status === "covered") continue;
    items.push({
      id: `dx-completeness-${item.field}`, dimension: "completeness", dimensionLabel: DIMENSION_LABELS.completeness,
      severity: "improve",
      title: item.status === "missing" ? `「${item.label}」缺失` : `「${item.label}」覆盖不足`,
      summary: item.situation,
      reason: item.basis,
      excerpt: logic[item.field].slice(0, 80),
      targetField: item.field, targetLabel: item.label,
      suggestion: item.suggestion,
    });
  }
  const lowSub = dimensions.actionability.subMetrics.filter(sub => sub.score < 80);
  if (lowSub.length) {
    const evidenceWeak = lowSub.some(sub => sub.key === "evidence_guidance");
    items.push({
      id: "dx-actionability-specificity", dimension: "actionability", dimensionLabel: DIMENSION_LABELS.actionability,
      severity: "improve", title: lowSub.length >= 2 ? "执行口径不够具体" : `${lowSub[0].label.split("（")[0]}偏弱`,
      summary: `${lowSub.map(sub => `${sub.label.split("（")[0]} ${sub.score} 分`).join("、")}${lowSub.length >= 2 ? "多项偏弱" : ""}。`,
      reason: lowSub.map(sub => `${sub.label.split("（")[0]}：${sub.reason}`).join("；"),
      excerpt: (evidenceWeak ? logic.facts : logic.conclusion).slice(0, 80),
      targetField: evidenceWeak ? "facts" : "conclusion",
      targetLabel: evidenceWeak ? "企业材料 / 官方依据" : "核心结论 / 执行口径",
      suggestion: lowSub.map(sub => sub.suggestion).join("；"),
    });
  }
  const unbounded = dimensions.boundaryRisk.risks.filter(risk => risk.status === "已识别未设边界");
  if (unbounded.length) {
    items.push({
      id: "dx-boundary-uncontrolled", dimension: "boundaryRisk", dimensionLabel: DIMENSION_LABELS.boundaryRisk,
      severity: "risk", title: "回答边界需要明确",
      summary: `${unbounded.length} 类风险表述未设置对应边界：${unbounded.map(risk => risk.kind).join("、")}。`,
      reason: `正文中检出 ${unbounded.map(risk => `「${risk.kind}」${risk.excerpt ? `（…${risk.excerpt.slice(0, 18)}…）` : ""}`).join("、")}等表述，但「回答边界/禁止表达」中没有对应的约束条目，生成内容时可能直接输出这些说法。`,
      excerpt: logic.boundaries.slice(0, 80),
      targetField: "boundaries", targetLabel: "回答边界 / 禁止表达",
      suggestion: `在回答边界中逐条补充：${unbounded.map(risk => risk.guidance).join("；")}。`,
    });
  }
  return items.slice(0, 6);
}
