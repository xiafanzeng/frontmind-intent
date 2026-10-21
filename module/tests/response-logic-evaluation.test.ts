import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ResponseLogicEvaluationPanel} from "../client/response-logic/evaluation-panel";
import {ResponseLogicOptimizationWorkflow} from "../client/response-logic/optimization-workflow";
import {createDemoEvaluation,createDemoOptimization,fingerprintLogic,LOGIC_FIELDS} from "../client/response-logic/mock-evaluation";
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
  expect(result.dimensions.completeness.coverage).toHaveLength(5);
  expect(result.dimensions.actionability.subMetrics).toHaveLength(3);
  for(const item of result.dimensions.completeness.coverage){
   expect(item.reason.length).toBeGreaterThan(6);expect(item.suggestion.length).toBeGreaterThan(6);
  }
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
 it("renders four metric cards, matrix and one concise data-source note (no demo banner)",()=>{
  const markup=renderToStaticMarkup(createElement(ResponseLogicEvaluationPanel,{evaluation:createDemoEvaluation(input),onBack:()=>{},onOptimize:()=>{}}));
  for(const title of ["Answer Relevance","Completeness","Actionability","Boundary / Risk Control"]){expect(markup).toContain(title);}
  expect(markup).toContain("rl-eval-layout");
  expect(markup).toContain("rl-eval-diagnosis");
  expect(markup).toContain("回答蓝图完整性矩阵");
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
