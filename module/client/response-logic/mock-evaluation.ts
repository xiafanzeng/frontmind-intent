/**
 * Local preview surface for the response-logic workbench.
 *
 * The deterministic rule engine moved to contracts/response-logic-evaluation.ts
 * and is now shared by the server evaluation API and this preview; everything
 * evaluation-related below is a re-export. Only the sample optimization draft
 * generator (createDemoOptimization) remains preview-only: P0 ships server-side
 * rule evaluation, not a real optimization generator.
 */
import { LOGIC_FIELDS, type LogicSections } from "../../contracts/response-logic-evaluation.js";
export {
  RULE_EVALUATION_VERSION,
  LOGIC_FIELDS,
  fingerprintLogic,
  createResponseLogicRuleEvaluation,
  createResponseLogicRuleEvaluation as createDemoEvaluation,
  buildRuleDiagnosis,
  buildRuleDiagnosis as buildDiagnosis,
} from "../../contracts/response-logic-evaluation.js";
export type {
  LogicField,
  LogicSections,
  ResponseLogicRuleEvaluationInput,
  ResponseLogicRuleEvaluation,
  ResponseLogicRuleEvaluation as DemoEvaluation,
  DiagnosisSeverity,
  DiagnosisDimension,
  DiagnosisItem,
} from "../../contracts/response-logic-evaluation.js";

const terms = (question: string) => question.replace(/[？?！!。，,\s]/g,"").split(/[：:；;、]/).flatMap(part=>part.length>=2?[part]:[]).slice(0,6);

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
export type DemoOptimization = ReturnType<typeof createDemoOptimization>;
