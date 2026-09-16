import type { WorkspaceQuestionCategory } from "../contracts/questions.js";
export const questionCategoryOptions = [
  { value: "industry", label: "行业排名词", quotaKey: "industry" },
  {
    value: "competitor_comparison",
    label: "竞品对比词",
    quotaKey: "competitor",
  },
  { value: "reputation", label: "美誉舆情词", quotaKey: "reputation" },
  {
    value: "product_scenario",
    label: "产品场景词",
    quotaKey: "scenario",
  },
] as const;

export const previewQuestionCategoryMeta = {
  industry: {
    quotaKey: "industry",
    groupId: "ranking",
    title: "行业排名词",
    subtitle: "行业入口与品牌优胜问题",
    tone: "amber",
  },
  competitor_comparison: {
    quotaKey: "competitor",
    groupId: "comparison",
    title: "竞品对比词",
    subtitle: "差异定位与选择依据",
    tone: "blue",
  },
  reputation: {
    quotaKey: "reputation",
    groupId: "reputation",
    title: "美誉舆情词",
    subtitle: "信任证据与品牌口碑",
    tone: "plum",
  },
  product_scenario: {
    quotaKey: "scenario",
    groupId: "scenario",
    title: "产品场景词",
    subtitle: "应用需求与决策问题",
    tone: "teal",
  },
} as const;

export type PreviewQuestionCategory = keyof typeof previewQuestionCategoryMeta;

export type PreviewConfirmedQuestion = {
  id: string;
  question: string;
  category: PreviewQuestionCategory;
};

export type BrandKeywordLibraryRef = {
  dashboardRevision: number;
  tableId: string;
  rowIndex: number;
};

export type QuestionIntakeOrigin = "brand_keyword_library" | "self_entered";

export type QuestionIntakeDraft = {
  origin: QuestionIntakeOrigin;
  question: string;
  category: WorkspaceQuestionCategory | null;
  libraryRef: BrandKeywordLibraryRef | null;
};

export type QuestionIntakeSubmitInput = QuestionIntakeDraft;
