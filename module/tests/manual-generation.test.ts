import {describe,it,expect} from "vitest";
import {standaloneQuestionContext,manualQuestionInput} from "../server/brand-question-portfolio-api";
describe("standalone question generation",()=>{
 const input={companyName:"合成企业",materials:"这是一份合成企业资料，介绍产品服务、客户场景和可引用事实。",questionGoal:"采购选型",perCategory:2};
 it("freezes manual materials and selected counts without a knowledge or quota record",()=>{
  const context=standaloneQuestionContext({id:"test-workspace"},"frontmind-base",input);
  expect(context.quotaPeriodId).toBe("test-workspace");expect(context.snapshot.id).toMatch(/^manual-/);expect(context.snapshot.documents[0].content).toBe(input.materials);expect(context.quota).toEqual({industry:2,competitorComparison:2,reputation:2,productScenario:2});
 });
 it("invalidates the signed snapshot input when reference material changes",()=>{
  const old=standaloneQuestionContext({id:"fixed"},"frontmind-base",input);const changed=standaloneQuestionContext({id:"fixed"},"frontmind-base",{...input,materials:input.materials+"补充资料"});
  expect(old.snapshot.archiveHash).not.toBe(changed.snapshot.archiveHash);expect(old.enterprise.identityHash).toBe(changed.enterprise.identityHash);
 });
 it("rejects caller supplied ownership and unbounded generation",()=>{
  expect(manualQuestionInput.safeParse({...input,ownerUserId:99}).success).toBe(false);expect(manualQuestionInput.safeParse({...input,perCategory:100}).success).toBe(false);
 });
});
