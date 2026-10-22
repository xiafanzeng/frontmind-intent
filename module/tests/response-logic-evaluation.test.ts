import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ResponseLogicEvaluationPanel} from "../client/response-logic/evaluation-panel";
import {ResponseLogicOptimizationWorkflow} from "../client/response-logic/optimization-workflow";
import {buildDiagnosis,createDemoEvaluation,createDemoOptimization,fingerprintLogic,LOGIC_FIELDS} from "../client/response-logic/mock-evaluation";
const logic={concern:"用户关注机构资质与真实性，担心选错服务商，希望有可核验的判断标准",conclusion:"先核验资质与授权，再对比服务范围与成功案例，最后按适用条件收敛选择。",facts:"资质证书：见官网公示\n授权文件：知识库文档\n案例记录：项目记录可回溯",boundaries:"不使用绝对化承诺；排名表述必须给出样本范围与时间。"};
const input={questionId:"q1",question:"机构靠谱吗？如何判断服务商资质？",intent:"机构可信度与选型判断标准",version:1,revision:2,logic};
describe("Response Logic frontend-sample evaluation",()=>{
 it("binds results to the question and version and fingerprint",()=>{
  const result=createDemoEvaluation(input);
  expect(result.questionId).toBe("q1");expect(result.version).toBe(1);expect(result.revision).toBe(2);
  expect(result.sourceFingerprint).toBe(fingerprintLogic(logic));
  expect(result.kind).toBe("sample-data");
 });
 it("returns four independent dimensions with rubric-based content and no aggregate",()=>{
  const result=createDemoEvaluation(input);
  expect(Object.keys(result.dimensions)).toEqual(["relevance","completeness","actionability","boundaryRisk"]);
  expect("overall" in result).toBe(false);
  const rel=result.dimensions.relevance;
  expect(rel.band.length).toBeGreaterThan(4);expect(rel.evidence.length).toBeGreaterThan(4);
  expect(rel.effect.length).toBeGreaterThan(6);expect(rel.method).toContain("评分区间");
  const cov=result.dimensions.completeness.coverage;
  expect(cov.map(i=>i.label)).toEqual(["用户真实关心","核心结论 / 执行口径","企业材料 / 官方依据","回答边界 / 禁止表达"]);
  for(const item of cov){expect(item.situation.length).toBeGreaterThan(4);expect(item.basis.length).toBeGreaterThan(6);expect(item.suggestion.length).toBeGreaterThan(6);}
  const recomputedCompleteness=Math.round(cov.reduce((s,i)=>s+(i.status==="covered"?100:i.status==="partial"?50:0),0)/4);
  expect(result.dimensions.completeness.score).toBe(recomputedCompleteness);
  const subs=result.dimensions.actionability.subMetrics;
  expect(subs.map(i=>i.key)).toEqual(["content_specificity","evidence_guidance","structure_guidance"]);
  for(const sub of subs){expect(sub.score).toBeGreaterThanOrEqual(0);expect(sub.score).toBeLessThanOrEqual(100);
   expect(sub.evidence.length).toBeGreaterThan(4);expect(sub.band.length).toBeGreaterThan(4);expect(sub.effect.length).toBeGreaterThan(6);}
  expect(result.dimensions.actionability.score).toBe(Math.round(subs.reduce((s,i)=>s+i.score,0)/3));
  const risks=result.dimensions.boundaryRisk.risks;
  expect(risks).toHaveLength(6);
  const riskLabels=["无依据排名","绝对化表达","缺乏依据的效果保证","未经核实的比较","缺少依据的事实性结论","缺失必要适用条件或限制"];
  for(const label of riskLabels){expect(risks.some(r=>r.label===label)).toBe(true);}
  const scored=risks.filter(r=>r.status==="controlled"||r.status==="partial"||r.status==="uncontrolled");
  expect(result.dimensions.boundaryRisk.score).toBe(scored.length?Math.round(scored.reduce((s,r)=>s+(r.status==="controlled"?100:r.status==="partial"?50:0),0)/scored.length):null);
  expect(result.dimensions.boundaryRisk.note).toContain("分母");
 });
 it("shows an unscorable boundary dimension instead of a default high score when nothing is scoreable",()=>{
  const emptyBoundary=createDemoEvaluation({...input,logic:{...logic,boundaries:"",conclusion:"背景介绍：知识管理是企业的重要能力。"}});
  expect(emptyBoundary.dimensions.boundaryRisk.score).not.toBeNull();
  const noRiskNoBoundary=createDemoEvaluation({...input,logic:{concern:"用户关心如何选型",conclusion:"先明确需求，再列候选，最后按条件收敛。",facts:"",boundaries:"",}});
  expect(noRiskNoBoundary.dimensions.boundaryRisk.risks.some(r=>r.status==="uncontrolled")).toBe(true);
 });
 it("is deterministic, does not mutate inputs and returns editable independent proposals",()=>{
  const before=JSON.stringify(input);
  expect(createDemoEvaluation(input)).toEqual(createDemoEvaluation(input));
  const proposal=createDemoOptimization(logic,{question:input.question,intent:input.intent});
  expect(proposal.sections.map(item=>item.field)).toEqual(LOGIC_FIELDS.map(item=>item.field));
  expect(proposal.sections[0].before).toBe(logic.concern);
  expect(proposal.sections[0].after).not.toBe(logic.concern);
  expect(proposal.sections[0].reason.length).toBeGreaterThan(6);
  expect(proposal.sections[0].resolvedIssues.length).toBeGreaterThan(0);
  expect(proposal.sections[0].remainingIssues.length).toBeGreaterThan(0);
  expect(JSON.stringify(input)).toBe(before);
 });
 it("builds actionable diagnoses with stable ids and valid locate targets",()=>{
  const evaluation=createDemoEvaluation(input);
  const diagnoses=buildDiagnosis(evaluation);
  expect(diagnoses.length).toBeGreaterThan(0);
  expect(diagnoses.length).toBeLessThanOrEqual(6);
  const validFields=["concern","conclusion","facts","boundaries"];
  for(const item of diagnoses){
   expect(item.id).toMatch(/^dx-[a-z]+-/);
   expect(["relevance","completeness","actionability","boundaryRisk"]).toContain(item.dimension);
   expect(["improve","risk"]).toContain(item.severity);
   expect(validFields).toContain(item.targetField);
   expect(item.title.length).toBeGreaterThan(4);
   expect(item.reason.length).toBeGreaterThan(10);
   expect(item.suggestion.length).toBeGreaterThan(8);
   expect(item.effect.length).toBeGreaterThan(6);
  }
  const ids=new Set(diagnoses.map(item=>item.id));
  expect(ids.size).toBe(diagnoses.length);
 });
 it("renders the diagnosis panel with expandable items and locate buttons",()=>{
  const markup=renderToStaticMarkup(createElement(ResponseLogicEvaluationPanel,{evaluation:createDemoEvaluation(input),onBack:()=>{},onOptimize:()=>{},onLocate:()=>{}}));
  expect(markup).toContain("诊断摘要");
  expect(markup).toContain("定位到对应内容");
  expect(markup).toContain("问题原因");
  expect(markup).toContain("修改建议");
  expect(markup).toContain("rl-dx-item");
  expect(markup).toContain("项待处理");
 });
 it("renders four metric cards, matrix and one concise data-source note (no demo banner)",()=>{
  const markup=renderToStaticMarkup(createElement(ResponseLogicEvaluationPanel,{evaluation:createDemoEvaluation(input),onBack:()=>{},onOptimize:()=>{}}));
  for(const title of ["Answer Relevance","Completeness","Actionability","Boundary / Risk Control"]){expect(markup).toContain(title);}
  expect(markup).toContain("rl-eval-layout");
  expect(markup).toContain("rl-eval-diagnosis");
  expect(markup).toContain("Completeness · 回答蓝图完整性");
  expect((markup.match(/rl-cov-item/g)||[]).length).toBeGreaterThanOrEqual(4);
  expect((markup.match(/rl-eval-table-scroll/g)||[]).length).toBe(0);
  expect(markup).toContain("查看完整性详情：四项必要内容");
  expect(markup).toContain("覆盖情况");
  expect(markup).toContain("判断依据");
  expect(markup).not.toContain('class="rl-eval-matrix');
  expect(markup).toContain("前端示例数据");
  expect(markup).not.toContain("演示评估（未接真实后端）");
  expect(markup).not.toContain("模拟结果");
 });
 it("renders selectable actions, editable draft and a local-preview adopt control",()=>{
  const markup=renderToStaticMarkup(createElement(ResponseLogicOptimizationWorkflow,{evaluation:createDemoEvaluation(input),logic,onBack:()=>{}}));
  expect((markup.match(/type="checkbox"/g)||[]).length).toBe(4);
  expect(markup).toContain("rl-opt-layout");
  expect(markup).toContain("采用（本地预览）");
  expect(markup).not.toContain("采用并保存（需后端支持后启用）");
  expect(markup).toContain("修改前");
  expect(markup).toContain("修改后");
  expect(markup).not.toContain("演示");
 });
});
