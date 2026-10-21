import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {ResponseLogicEvaluationPanel} from "../client/response-logic/evaluation-panel";
import {ResponseLogicOptimizationWorkflow} from "../client/response-logic/optimization-workflow";
import {createDemoEvaluation,createDemoOptimization,fingerprintLogic,LOGIC_FIELDS} from "../client/response-logic/mock-evaluation";
const logic={concern:"用户关注资质",conclusion:"回答核心顾虑",facts:"",boundaries:""};
const input={questionId:"q1",question:"机构靠谱吗？",intent:"机构可信度",version:1,revision:2,logic};
describe("Response Logic demo-only evaluation",()=>{
 it("binds results to the question and version and fingerprint",()=>{
  const result=createDemoEvaluation(input);
  expect(result.questionId).toBe("q1");expect(result.version).toBe(1);expect(result.revision).toBe(2);
  expect(result.sourceFingerprint).toBe(fingerprintLogic(logic));
  expect(result.kind).toBe("rules-demo");
 });
 it("only returns four dimensions, no aggregate score, with explicit unknown risk",()=>{
  const result=createDemoEvaluation(input);
  expect(Object.keys(result.dimensions)).toEqual(["relevance","completeness","actionability","boundaryRisk"]);
  expect(result.dimensions.completeness.coverage).toHaveLength(5);
  expect(result.dimensions.actionability.subMetrics).toHaveLength(3);
  expect(result.dimensions.boundaryRisk.score).toBeNull();
  expect(result.dimensions.boundaryRisk.judgeRan).toBe(false);
  expect("overall" in result).toBe(false);
 });
 it("is deterministic, does not mutate inputs and returns editable independent proposals",()=>{
  const before=JSON.stringify(input);
  expect(createDemoEvaluation(input)).toEqual(createDemoEvaluation(input));
  const proposal=createDemoOptimization(logic);
  expect(proposal.sections.map(item=>item.field)).toEqual(LOGIC_FIELDS.map(item=>item.field));
  expect(proposal.sections[0].before).toBe(logic.concern);
  expect(proposal.sections[0].after).not.toBe(logic.concern);
  expect(JSON.stringify(input)).toBe(before);
 });
 it("renders four metric cards and detailed diagnosis in the reference workbench structure",()=>{
  const markup=renderToStaticMarkup(createElement(ResponseLogicEvaluationPanel,{evaluation:createDemoEvaluation(input),onBack:()=>{},onOptimize:()=>{}}));
  for(const title of ["Answer Relevance","Completeness","Actionability","Boundary / Risk Control"]){expect(markup).toContain(title);}
  expect(markup).toContain("rl-eval-layout");
  expect(markup).toContain("rl-eval-diagnosis");
  expect(markup).toContain("回答蓝图完整性矩阵");
  expect(markup).toContain("演示评估（未接真实后端）");
 });
 it("renders selectable optimization actions and a disabled formal adopt control",()=>{
  const markup=renderToStaticMarkup(createElement(ResponseLogicOptimizationWorkflow,{evaluation:createDemoEvaluation(input),logic,onBack:()=>{}}));
  expect((markup.match(/type="checkbox"/g)||[]).length).toBe(4);
  expect(markup).toContain("rl-opt-layout");
  expect(markup).toContain("采用并保存（需后端支持后启用）");
  expect(markup).toMatch(/disabled[^>]*>采用并保存/);
  expect(markup).toContain("修改前");
  expect(markup).toContain("修改后");
 });
});
