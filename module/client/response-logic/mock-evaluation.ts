/**
 * Frontend sample data for the response-logic evaluation preview.
 * Pure functions of the current question/intent/logic text: no network,
 * no persistence, no Agent and no factual judging.
 *
 * Rule model (frontend sample, honestly labelled):
 * - Four independent dimensions, no aggregate score.
 * - Each dimension has its own object, rubric, evidence and diagnosis;
 *   cross-dimension problems need independent evidence (no double counting).
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
const excerptAround = (text: string, index: number, len = 24) => text.slice(Math.max(0, index - 12), index + len);

/** Risk categories with separate scan (text detection) and boundary (control) patterns. */
const RISK_CATEGORIES = [
  {key:"unverified_ranking" as const,label:"无依据排名",
    scan:/第[一二三四五六七八九十\d]+|排名第一|行业第一/,boundary:/排名|名次|榜单|样本范围|评价维度/,
    applicable:/排名|榜单|行业|第一|领先|对比|选型/,
    guidance:"排名表述必须同时给出样本范围、评价维度与信息时间，否则删除或改为区间描述。"},
  {key:"absolute_claim" as const,label:"绝对化表达",
    scan:/唯一|独家|绝对领先|绝对优势/,boundary:/唯一|独家|绝对|禁用|不使用|不得/,
    applicable:null as RegExp|null,guidance:"改为可核验的限定表述，例如「在 XX 样本与时间范围内」+ 可追溯来源。"},
  {key:"effect_promise" as const,label:"缺乏依据的效果保证",
    scan:/保证|承诺.{0,4}(收录|效果|成功)|百分百|100%|确保/,boundary:/保证|承诺|效果|确保|以.{0,8}为准/,
    applicable:/效果|结果|成功|收录|优化|提升/,guidance:"效果类承诺必须注明适用前提，并以最终确认文件为准。"},
  {key:"unverified_comparison" as const,label:"未经核实的比较",
    scan:/(远超|吊打|碾压).{0,8}(竞品|同行|对手)|比.{0,6}更好/,boundary:/比较|对比|竞品|并列.{0,6}(条件|来源)/,
    applicable:/竞品|对比|比较|同行|优劣|差异/,guidance:"竞品比较须并列比较条件与数据来源；无法核实时改为客观差异描述。"},
  {key:"unsupported_fact" as const,label:"缺少依据的事实性结论",
    scan:null as RegExp|null,boundary:/依据|来源|核验|可追溯|绑定/,
    applicable:null as RegExp|null,guidance:"每条事实性结论应绑定来源；无法绑定来源的表述移入「回答边界」作为限制说明。"},
  {key:"missing_precondition" as const,label:"缺失必要适用条件或限制",
    scan:null as RegExp|null,boundary:/适用|前提|条件|限制|以.{0,8}为准/,
    applicable:null as RegExp|null,guidance:"涉及价格、效果、周期或排名的表述必须注明适用前提。"},
];
const GENERIC_BOUNDARY = /不|禁止|须|应|避免|不得/;

export function createDemoEvaluation(input:{questionId:string;question:string;intent:string;version:number|null;revision:number;logic:LogicSections}) {
  const {logic,question,intent}=input;
  const questionTerms=terms(question);
  const conclusionSentences=sentences(logic.conclusion);
  const factLines=lines(logic.facts);
  const evidenceMarkers=["知识库","来源","文档","官网","授权","依据","可追溯","记录"].filter(marker=>logic.facts.includes(marker));
  const numbered=/(?:(?:^|\n)\s*(?:\d+[.、）)]|[①②③④⑤]))/.test(logic.conclusion);
  const boundaryRules=lines(logic.boundaries);

  /* ---------- 1) Answer Relevance：是否回应了 Question + Intent（只此一件事） ---------- */
  const matchedTerms=questionTerms.filter(term=>logic.conclusion.includes(term)||logic.concern.includes(term));
  const missingTerms=questionTerms.filter(term=>!matchedTerms.includes(term));
  const coverageRatio=questionTerms.length?matchedTerms.length/questionTerms.length:0.5;
  const firstSentence=conclusionSentences[0]??"";
  const firstSentenceDirect=questionTerms.some(term=>firstSentence.includes(term));
  const intentTerms=terms(intent).filter(term=>term.length>=2);
  const intentEcho=intentTerms.length?intentTerms.filter(term=>logic.concern.includes(term)||logic.conclusion.includes(term)).length/intentTerms.length:0.5;
  // 评分区间：90–100 / 75–89 / 60–74 / 40–59 / 0–39（覆盖率为入档信号，档内再按结构信号微调）
  let relBand=40;
  if(coverageRatio>=0.99)relBand=90;else if(coverageRatio>=0.75)relBand=75;else if(coverageRatio>=0.5)relBand=60;else if(coverageRatio>0)relBand=40;else relBand=30;
  let relAdjust=0;
  if(firstSentenceDirect)relAdjust+=4;
  if(intentEcho>=0.5)relAdjust+=3;
  if(logic.conclusion.trim().length<60)relAdjust-=4;
  const relevanceScore=score(relBand+relAdjust);
  const relevanceBandLabel=relevanceScore>=90?"直接回应核心问题":relevanceScore>=75?"整体相关，部分关注点未充分回应":relevanceScore>=60?"部分回应，关键决策疑问未解决":relevanceScore>=40?"以背景信息为主，未明确回答核心问题":"明显偏题或基本未回应问题";
  const relevanceIssues=[
    ...missingTerms.slice(0,2).map(term=>`问题关键词「${term}」未进入结论或关心点，读者需自行推断回答与问题的关联。`),
    ...(firstSentenceDirect||!firstSentence?[]:["结论首句没有直接回应问题主语，先给了背景或方法铺垫。"]),
    ...(coverageRatio===0?["未检测到任何问题关键词进入应答逻辑，倾向泛泛介绍相关知识。"]:[]),
  ].slice(0,3);

  /* ---------- 2) Completeness：四个必要组成部分是否覆盖（只判覆盖，不判具体/切题） ---------- */
  const coverage=[
    {field:"concern" as const,label:"用户真实关心",text:logic.concern,
      requirement:"完整转述用户的决策疑问与在意点",
      sufficient:()=>logic.concern.trim().length>=40&&(logic.concern.includes("？")||intentTerms.some(term=>logic.concern.includes(term))||logic.concern.trim().length>=60),
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：应答逻辑未包含用户视角。"
        :status==="partial"?`已有 ${len} 字，但尚未形成「决策疑问 + 在意点」的覆盖性表述（建议 ≥40 字并点明在意什么）。`
        :`共 ${len} 字，已包含用户视角与在意点，覆盖达标。`},
    {field:"conclusion" as const,label:"核心结论 / 执行口径",text:logic.conclusion,
      requirement:"给出明确结论与后续内容如何表达展开的口径",
      sufficient:()=>conclusionSentences.length>=2&&logic.conclusion.length>=60,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：缺少回答的主结论。"
        :status==="partial"?`共 ${len} 字 / ${conclusionSentences.length} 句，尚无「结论 + 执行口径」的覆盖形态（建议 ≥2 句且 ≥60 字）。`
        :`共 ${len} 字 / ${conclusionSentences.length} 句，已包含结论与执行口径两部分。`},
    {field:"facts" as const,label:"企业材料 / 官方依据",text:logic.facts,
      requirement:"提供相关事实、材料依据或可追溯来源",
      sufficient:()=>factLines.length>=2,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：回答将缺少事实材料。"
        :status==="partial"?`已有 ${factLines.length} 行内容${evidenceMarkers.length?`（含来源标记：${evidenceMarkers.slice(0,2).join("、")}）`:"，未检出来源标记"}，覆盖尚不充分（建议 ≥2 行事实或来源条目）。`
        :`${factLines.length} 行事实/来源内容，覆盖达标。`},
    {field:"boundaries" as const,label:"回答边界 / 禁止表达",text:logic.boundaries,
      requirement:"明确适用条件、必要限制及不应出现的表达",
      sufficient:()=>logic.boundaries.trim().length>=30,
      basis:(status:string,len:number)=>status==="missing"?"该部分为空：未设置任何回答边界。"
        :status==="partial"?`已有 ${len} 字，限制或禁止表达较笼统（建议 ≥30 字并逐条列出）。`
        :`共 ${len} 字，已列出限制与禁止表达，覆盖达标。`},
  ].map(({field,label,text,requirement,sufficient,basis})=>{
    const len=text.trim().length;
    const status=!text.trim()?"missing"as const:sufficient()?"covered"as const:"partial"as const;
    const statusText=status==="covered"?"完整":status==="partial"?"部分覆盖":"缺失";
    const situation=status==="missing"?`「${label}」缺失`:`「${label}」${statusText}`;
    const suggestion=status==="missing"?`补写「${label}」：${requirement}。`
      :status==="partial"?`继续完善「${label}」：${requirement}。`
      :`「${label}」覆盖已达标；内容的可执行程度与切题性由其他维度分别评估。`;
    return {field,label,status,statusText,situation,basis:basis(status,len),requirement,suggestion};
  });
  const completenessScore=score(coverage.reduce((sum,v)=>sum+(v.status==="covered"?100:v.status==="partial"?50:0),0)/4);

  /* ---------- 3) Actionability：后续 Agent 能否直接照做（三个子维度 Rubric） ---------- */
  const VAGUE=["突出优势","增强信任","详细介绍","全面介绍","充分展示","提升形象","赋能"];
  const vagueHits=VAGUE.flatMap(phrase=>{
    const at=logic.conclusion.indexOf(phrase);
    return at>=0?[{phrase,excerpt:excerptAround(logic.conclusion,at,phrase.length+12)}]:[];
  });
  const mappingWords=["对应","绑定","逐条","一一对应"].filter(word=>logic.facts.includes(word)||logic.conclusion.includes(word));
  const missingHandle=/待核验|缺少依据|无法核验|移入|不作为依据/.test(logic.facts+logic.boundaries);
  const orderMarkers=["首句","先","再","最后","分条","步骤","顺序","口径"].filter(marker=>logic.conclusion.includes(marker));
  const bandOf=(value:number)=>value>=90?"指令具体，基本可直接执行":value>=75?"整体可执行，少量细节待补":value>=60?"有方向但关键操作细节不足":value>=40?"以笼统建议为主，需自行推断":"几乎无可执行指令";
  const subMetrics=[
    {key:"content_specificity" as const,label:"内容具体度",
      raw:(numbered?80:55)-vagueHits.length*12+((/判断条件|标准|阈值/.test(logic.conclusion))?8:0),
      reason:`${numbered?"执行口径包含编号步骤（可直接执行的主干）":"执行口径未采用编号步骤"}${vagueHits.length?`；检出 ${vagueHits.length} 处笼统指令`:"；未检出「突出优势/详细介绍」类笼统指令"}。`,
      evidence:vagueHits[0]?`「…${vagueHits[0].excerpt}…」`:(numbered?`编号步骤示例：${conclusionSentences.find(s=>/\d|[①②③]/.test(s))?.slice(0,30)??firstSentence.slice(0,30)}…`:`结论开头：「${firstSentence.slice(0,30)}…」`),
      issue:vagueHits.length?"笼统指令无法直接转化为写作动作。":"缺少编号步骤时，后续 Agent 需自行拆解动作。",
      suggestion:vagueHits.length?`替换笼统指令为「信息点 + 动作 + 判断条件」，例如把「突出优势」改为「列出 3 项可核验优势并各配一条来源」。`:"将执行口径改写为编号步骤，每步含可操作动作与判断条件。",
      effect:"修改后每条指令都能对应到具体段落与素材，无需二次解释。"},
    {key:"evidence_guidance" as const,label:"证据指引",
      raw:40+Math.min(45,evidenceMarkers.length*15)+(mappingWords.length?12:0)+(missingHandle?15:0),
      reason:`来源标记 ${evidenceMarkers.length} 处${evidenceMarkers.length?`（${evidenceMarkers.slice(0,3).join("、")}）`:""}${mappingWords.length?`；有事实↔证据映射用语（${mappingWords.slice(0,2).join("、")}）`:"；未检出事实与证据的映射要求"}${missingHandle?"；说明了缺依据时的处理方式":"；未说明缺少依据时如何处理"}。`,
      evidence:evidenceMarkers[0]?`「…${excerptAround(logic.facts,logic.facts.indexOf(evidenceMarkers[0]),20)}…」`:`依据栏开头：「${logic.facts.slice(0, 30)}…」`,
      issue:evidenceMarkers.length<2?"后续 Agent 无法确定每条事实应引用哪份材料。":"映射关系已可追溯，但缺据处理仍可补充。",
      suggestion:"为每条事实标注来源（知识库文档/官网/授权文件/项目记录），并写明「无法核验的表述不作为依据」。",
      effect:"修改后每条事实都能定位到可核验来源，缺据内容会被显式降级处理。"},
    {key:"structure_guidance" as const,label:"结构引导",
      raw:40+Math.min(48,orderMarkers.length*12)+(numbered?15:0),
      reason:`展开顺序信号 ${orderMarkers.length} 个${orderMarkers.length?`（${orderMarkers.slice(0,4).join("、")}）`:"（未检出「首句/分条/顺序」类信号）"}${numbered?"；编号步骤提供了执行顺序":""}。`,
      evidence:orderMarkers[0]?`「…${excerptAround(logic.conclusion,logic.conclusion.indexOf(orderMarkers[0]),20)}…」`:`结论开头：「${firstSentence.slice(0,30)}…」`,
      issue:orderMarkers.length<3?"未规定内容组织顺序，段落结构由后续 Agent 自行决定。":"组织顺序已有基本约定。",
      suggestion:"按「首句回应决策重点 → 3-5 项事实展开 → 适用条件与限制收束」写明段落组织要求。",
      effect:"修改后内容结构稳定一致，不随执行 Agent 变化。"},
  ].map(({raw,...rest})=>({...rest,score:score(raw),band:bandOf(score(raw))}));
  const actionabilityScore=score(subMetrics.reduce((sum,v)=>sum+v.score,0)/3);

  /* ---------- 4) Boundary / Risk：区分文本检出、边界设置、不适用与无法判断 ---------- */
  const riskList=RISK_CATEGORIES.map(cat=>{
    const contextText=question+intent+logic.conclusion+logic.facts;
    const applicable=cat.applicable?cat.applicable.test(contextText):cat.key!=="unsupported_fact"||factLines.length>0;
    const textHit=cat.scan?cat.scan.test(logic.conclusion)||cat.scan.test(logic.facts)
      :cat.key==="unsupported_fact"?factLines.length>0&&evidenceMarkers.length===0
      :/价格|效果|周期|排名/.test(contextText);
    const hitExcerpt=(():string=>{
      if(!cat.scan)return"";
      const m=cat.scan.exec(logic.conclusion+logic.facts);
      return m?excerptAround(logic.conclusion+logic.facts,m.index,m[0].length+12):"";
    })();
    const ruleMatched=boundaryRules.some(rule=>cat.boundary.test(rule));
    const genericOnly=!ruleMatched&&boundaryRules.some(rule=>GENERIC_BOUNDARY.test(rule));
    let status:"controlled"|"partial"|"uncontrolled"|"undetected"|"notApplicable"|"indeterminate";
    if(ruleMatched)status="controlled";
    else if(textHit&&(genericOnly||cat.key==="unsupported_fact"&&genericOnly))status="partial";
    else if(textHit)status="uncontrolled";
    else if(!applicable)status="notApplicable";
    else if(boundaryRules.length===0&&(cat.key==="absolute_claim"||cat.key==="missing_precondition"))status="uncontrolled";
    else status="undetected";
    const statusText={controlled:"已明确控制",partial:"部分控制",uncontrolled:"发现风险但未控制",undetected:"未检出相关表述",notApplicable:"不适用",indeterminate:"无法判断"}[status];
    const guidance=ruleMatched?`回答边界已包含该类约束：${cat.guidance}`
      :textHit?cat.guidance
      :status==="uncontrolled"?`该类风险在当前场景通用适用，但「回答边界」未设置对应约束：${cat.guidance}`
      :`未在正文检出该类表述（这只是文本检查结果，不代表边界已设置）；建议预先写明：${cat.guidance}`;
    return {key:cat.key,label:cat.label,status,statusText,excerpt:hitExcerpt,applicable,guidance};
  });
  const scored=riskList.filter(risk=>risk.status==="controlled"||risk.status==="partial"||risk.status==="uncontrolled");
  const boundaryScore=scored.length?score(scored.reduce((sum,risk)=>sum+(risk.status==="controlled"?100:risk.status==="partial"?50:0),0)/scored.length):null;
  const boundaryNote=scored.length
    ?`适用 ${riskList.filter(r=>r.applicable).length} 类风险，计分分母 ${scored.length} 类：明确控制 ${scored.filter(r=>r.status==="controlled").length}、部分控制 ${scored.filter(r=>r.status==="partial").length}、未控制 ${scored.filter(r=>r.status==="uncontrolled").length}；未检出 ${riskList.filter(r=>r.status==="undetected").length} 类与不适用 ${riskList.filter(r=>r.status==="notApplicable").length} 类未计入分母。未检出仅代表未在正文检出该类表述，不等于已设置边界。`
    :"当前没有可计分的适用风险项（均未检出或不适用），暂不可评分；这不代表风险控制已达标。";

  return {kind:"sample-data" as const,...input,sourceFingerprint:fingerprintLogic(logic),dimensions:{
    relevance:{score:relevanceScore,band:relevanceBandLabel,
      reason:`关键词覆盖 ${matchedTerms.length}/${questionTerms.length}${missingTerms.length?`（缺失：${missingTerms.slice(0,2).join("、")}）`:""}，结论首句${firstSentenceDirect?"有":"没有"}直接回应，意图贯穿度 ${Math.round(intentEcho*100)}% → 评分区间「${relevanceBandLabel}」。本维度只评估是否回应 Question/Intent；组成部分齐全度归「完整性」，指令具体度归「可执行性」，无依据承诺归「边界与风险控制」。`,
      evidence:`结论首句：「${firstSentence.slice(0,40)||"（空）"}…」`,
      issues:relevanceIssues,
      suggestions:["在结论首句直接回应问题主语与决策动作。","将「用户真实关心」中的在意点逐条映射到执行口径。"],
      effect:"修改后读者第一句就能看到对原问题的直接回答，且各在意点均有对应口径。",
      method:"评分区间 90/75/60/40/0（关键词覆盖×结构信号，前端规则示例，非 Ragas / DeepEval 语义评估）"},
    completeness:{score:completenessScore,
      reason:`四项必要内容：${coverage.filter(v=>v.status==="covered").length} 完整、${coverage.filter(v=>v.status==="partial").length} 部分覆盖、${coverage.filter(v=>v.status==="missing").length} 缺失；(100×完整 + 50×部分 + 0×缺失) ÷ 4，四舍五入。只判覆盖，不因不够具体或不够切题在此重复扣分。`,coverage},
    actionability:{score:actionabilityScore,
      reason:`三个子维度（内容具体度 ${subMetrics[0].score} / 证据指引 ${subMetrics[1].score} / 结构引导 ${subMetrics[2].score}）取算术平均，四舍五入。每项依据 Rubric 区间 90/75/60/40/0 评分并附文本依据。`,
      subMetrics},
    boundaryRisk:{score:boundaryScore,
      note:boundaryNote,risks:riskList,
      method:"六类风险 × 文本检出与边界设置对照：明确控制=100、部分控制=50、未控制=0；未检出/不适用/无法判断不计分母（前端规则示例）"},
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
      reason="将意图转写为具体决策场景与在意点清单，使后续结论逐条对应（改善「回答相关性」的关键词覆盖）。";
      resolvedIssues=["用户在意点未显式列出","结论与「用户真实关心」的映射缺失"];
      remainingIssues.push("在意点需与真实用户反馈核对后定稿。");
    }else if(field==="conclusion"){
      after=[after||"（原文为空）",`执行口径（建议采用编号步骤）：\n1. 首句直接回应问题主语与决策动作${questionTerms.length?`（${questionTerms.slice(0,2).join("、")}）`:""}；\n2. 按样本范围、评价维度、信息时间三项标准核对外部榜单；\n3. 给出分类型候选清单与选择建议；\n4. 以适用条件与限制收束，允许读者回溯依据。`].join("\n\n");
      reason="把执行口径改写为编号步骤，补齐「判断条件 + 动作 + 依据」要素（改善「可执行性」的内容具体度与结构引导）。";
      resolvedIssues=["结论缺少编号步骤","结构信号不足"];
      remainingIssues.push("步骤中的判断阈值需结合业务口径确认。");
    }else if(field==="facts"){
      after=[after||"（原文为空）",`来源绑定建议：\n- 每条事实行末标注（知识库文档 / 官网 / 授权文件 / 项目记录）；\n- 无法绑定来源的表述移入「回答边界」作为限制说明。`].join("\n\n");
      reason="为事实清单增加逐条来源绑定规则，补齐证据覆盖项（改善「完整性」的企业材料与官方依据覆盖）。";
      resolvedIssues=["证据缺少来源标记"];
      remainingIssues.push("来源清单需与知识库实际文档核对。");
    }else{
      after=[after||"（原文为空）",`禁止与谨慎表达清单：\n1. 无依据排名：仅在有样本范围、评价维度与信息时间时使用排名表述；\n2. 绝对化承诺：不用「唯一/绝对领先/保证收录」类表述；\n3. 未经核实的比较：竞品对比必须并列比较条件与数据来源；\n4. 价格与周期：注明适用前提，以最终确认文件为准。`].join("\n\n");
      reason="将边界整理为逐条禁止/谨慎清单，与风险扫描的六类风险一一对应（改善「边界与风险控制」的未受控项）。";
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
  effect: string;
};
const DIMENSION_LABELS: Record<DiagnosisDimension, string> = {
  relevance: "回答相关性", completeness: "完整性",
  actionability: "可执行性", boundaryRisk: "边界与风险控制",
};
/**
 * Derive the actionable diagnosis list from one demo evaluation. Pure and
 * deterministic; each item keeps a stable id plus a target logic field, states
 * its primary dimension, and explains the expected effect after the fix.
 * Cross-dimension problems appear once per dimension only with independent
 * evidence (no duplicated deduction of the same root cause).
 */
export function buildDiagnosis(evaluation: DemoEvaluation): DiagnosisItem[] {
  const { dimensions, logic, question } = evaluation;
  const items: DiagnosisItem[] = [];
  const qTerms = terms(question);
  const matched = qTerms.filter(term => logic.conclusion.includes(term) || logic.concern.includes(term));
  const missingTerms = qTerms.filter(term => !matched.includes(term));
  if (missingTerms.length || dimensions.relevance.score < 90) {
    items.push({
      id: "dx-relevance-conclusion", dimension: "relevance", dimensionLabel: DIMENSION_LABELS.relevance,
      severity: "improve", title: "核心结论未直接回应问题",
      summary: missingTerms.length ? `问题关键词「${missingTerms.slice(0, 2).join("、")}」没有进入核心结论。` : `结论对问题「${question.slice(0, 18)}…」的回应不够直接（当前 ${dimensions.relevance.score} 分）。`,
      reason: dimensions.relevance.reason,
      excerpt: dimensions.relevance.evidence,
      targetField: "conclusion", targetLabel: "核心结论 / 执行口径",
      suggestion: dimensions.relevance.suggestions.join("；"),
      effect: dimensions.relevance.effect,
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
      effect: `补齐后该项按完整（100）计入「完整性」，当前 ${(dimensions.completeness.score)} 分将相应提升。`,
    });
  }
  const lowSub = dimensions.actionability.subMetrics.filter(sub => sub.score < 80);
  if (lowSub.length) {
    const evidenceWeak = lowSub.some(sub => sub.key === "evidence_guidance");
    items.push({
      id: "dx-actionability-specificity", dimension: "actionability", dimensionLabel: DIMENSION_LABELS.actionability,
      severity: "improve", title: lowSub.length >= 2 ? "执行口径不够具体" : `${lowSub[0].label.split("（")[0]}偏弱`,
      summary: `${lowSub.map(sub => `${sub.label.split("（")[0]} ${sub.score} 分`).join("、")}。`,
      reason: lowSub.map(sub => `${sub.label.split("（")[0]}：${sub.reason} 文本依据 ${sub.evidence}`).join("；"),
      excerpt: (evidenceWeak ? logic.facts : logic.conclusion).slice(0, 80),
      targetField: evidenceWeak ? "facts" : "conclusion",
      targetLabel: evidenceWeak ? "企业材料 / 官方依据" : "核心结论 / 执行口径",
      suggestion: lowSub.map(sub => sub.suggestion).join("；"),
      effect: lowSub.map(sub => sub.effect).join("；"),
    });
  }
  const uncontrolled = dimensions.boundaryRisk.risks.filter(risk => risk.status === "uncontrolled" || risk.status === "partial");
  if (uncontrolled.length) {
    items.push({
      id: "dx-boundary-uncontrolled", dimension: "boundaryRisk", dimensionLabel: DIMENSION_LABELS.boundaryRisk,
      severity: "risk", title: "回答边界需要明确",
      summary: `${uncontrolled.length} 类风险未获有效控制：${uncontrolled.map(risk => `${risk.label}（${risk.statusText}）`).join("、")}。`,
      reason: `按六类风险逐项对照文本检出与边界设置：${uncontrolled.map(risk => `「${risk.label}」${risk.excerpt ? `正文检出「…${risk.excerpt.slice(0, 16)}…」、` : ""}${risk.status === "uncontrolled" ? "边界中无对应约束" : "边界仅有笼统约束"}`).join("；")}。`,
      excerpt: logic.boundaries.slice(0, 80),
      targetField: "boundaries", targetLabel: "回答边界 / 禁止表达",
      suggestion: `在回答边界中逐条补充：${uncontrolled.map(risk => risk.guidance).join("；")}。`,
      effect: "补齐后对应风险按「已明确控制」计入分母，「边界与风险控制」分数按分母重算；未检出的类别仍不会因此记满分。",
    });
  }
  return items.slice(0, 6);
}
