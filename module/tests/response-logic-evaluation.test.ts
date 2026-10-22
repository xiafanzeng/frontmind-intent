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
 it("returns four independent dimensions with rich per-dimension content and no aggregate",()=>{
  const result=createDemoEvaluation(input);
  expect(Object.keys(result.dimensions)).toEqual(["relevance","completeness","actionability","boundaryRisk"]);
  expect(result.dimensions.completeness.coverage).toHaveLength(4);
  expect(result.dimensions.completeness.coverage.map(i=>i.label)).toEqual(["用户真实关心","核心结论 / 执行口径","企业材料 / 官方依据","回答边界 / 禁止表达"]);
  for(const item of result.dimensions.completeness.coverage){expect(item.situation.length).toBeGreaterThan(4);expect(item.basis.length).toBeGreaterThan(6);expect(item.suggestion.length).toBeGreaterThan(6);}
  expect(result.dimensions.actionability.subMetrics).toHaveLength(3);
  for(const item of result.dimensions.actionability.subMetrics){
   expect(item.score).toBeGreaterThanOrEqual(0);expect(item.score).toBeLessThanOrEqual(100);
   expect(item.reason.length).toBeGreaterThan(6);expect(item.suggestion.length).toBeGreaterThan(6);
  }
  expect(result.dimensions.relevance.issues.length + result.dimensions.relevance.reason.length).toBeGreaterThan(10);
  expect(typeof result.dimensions.boundaryRisk.score).toBe("number");
  expect(result.dimensions.boundaryRisk.risks.length).toBeGreaterThan(0);
  expect("overall" in result).toBe(false);
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
