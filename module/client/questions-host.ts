import type { PublicServicePortalQuestion } from "../contracts/questions.js";
import type { QuestionIntakeSubmitInput } from "./question-intake.js";
export type ServicePortalView = { capabilities: { questionSelection: { allowed: boolean; reason?: string | null } } };
export type ManagedKeywordTable = { id: string; title: string; description?: string | null; columns: string[]; rows: unknown[][] };
export interface IntentQuery<T> { data?: T; isLoading: boolean; isError: boolean; refetch(): Promise<unknown>; }
export interface QuestionsHost {
 useBusinessWorkspace(): { task?: { scopeKey: string } | null };
 useBusinessWorkspaceSummary(input: {title: string;items: {label:string;value:string}[];outputs: never[]}): void;
 trpc: {
  useUtils(): { workspace: { questionPortfolio: { invalidate(): Promise<unknown> }; portal: { invalidate(): Promise<unknown> }; responseLogic: { invalidate(): Promise<unknown> } } };
  workspace: {
   questionPortfolio: { useQuery(input: undefined, options: {retry: boolean}): IntentQuery<{questions: PublicServicePortalQuestion[]}> };
   dashboard: { useQuery(input: undefined, options: {retry:boolean}): IntentQuery<{revision: number;payload: {keywordTables: ManagedKeywordTable[]}}> };
   requestQuestionSelection: { useMutation(): { mutateAsync(input: {mode:"direct";question:string;category: NonNullable<QuestionIntakeSubmitInput["category"]>} | {mode:"brand_keyword_library";dashboardRevision:number;tableId:string;rowIndex:number}): Promise<{question:PublicServicePortalQuestion}> } };
   questionMaintenance: { execute: {useMutation(): {mutateAsync(input: {questionId:string;expectedRevision:number;clientRequestId:string;} & ({action:"delete"} | {action:"modify";proposedQuestion:string}) & {}): Promise<{questionId:string;replacementQuestionId?:string | null}>} } };
  };
 };
}
