import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  startJudgeEvaluation,
  pollJudgeTask,
  judgeContextKey,
  JudgeRequestError,
} from "./response-logic-judge-client.js";
import type { JudgeOutput } from "../contracts/response-logic-judge.js";
import {
  createTaskLifecycleReducer,
  initialTaskLifecycleState,
  taskStartBlocked,
  type TaskLifecycleEvent,
  type TaskLifecycleState,
  type TaskPhase,
} from "./task-lifecycle.js";

export type JudgePhase = TaskPhase;

export type JudgeState = Omit<TaskLifecycleState<JudgeOutput>, "activeContext">;

/** JudgeState bound to the context (questionId + revision + fingerprint) it belongs to. */
export type JudgeLifecycleState = TaskLifecycleState<JudgeOutput>;

export type JudgeLifecycleEvent = TaskLifecycleEvent<JudgeOutput>;

export const initialJudgeLifecycleState: JudgeLifecycleState = initialTaskLifecycleState<JudgeOutput>();

/** Backwards-compatible alias; the judge start guard is the shared one. */
export const judgeStartBlocked = taskStartBlocked;

/**
 * Pure lifecycle state machine for the judge evaluation — one shared machine
 * (task-lifecycle.ts) for judge and optimizer, instantiated per flow.
 */
export const judgeEvaluationReducer = createTaskLifecycleReducer<JudgeOutput>({
  timeoutCode: "JUDGE_TIMEOUT",
  timeoutMessage: "Judge 评估超时（轮询次数达到上限）",
});

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100; // ~5 minutes

/**
 * Manages the LLM-as-Judge async task lifecycle with context protection.
 *
 * Context key (questionId + revision + fingerprint) guards against stale
 * results: before applying any poll response, the reducer verifies that the
 * task's context still matches the active one. If it doesn't (question
 * switched or draft edited), the response is silently dropped and polling is
 * aborted.
 *
 * Polling stops on: completion, failure, context change, or max attempts.
 */
export function useJudgeEvaluation(input: {
  questionId: string;
  recordRevision: number;
  sourceFingerprint: string;
}) {
  const [state, dispatch] = useReducer(judgeEvaluationReducer, initialJudgeLifecycleState);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollCountRef = useRef(0);
  // Mirrors the dispatched phase so a second click within the same render
  // frame is rejected before any fetch is issued.
  const phaseRef = useRef<JudgePhase>(initialJudgeLifecycleState.phase);
  phaseRef.current = state.phase;

  const contextKey = judgeContextKey(input.questionId, input.recordRevision, input.sourceFingerprint);

  // On context change: cancel polling, reset state
  useEffect(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    pollCountRef.current = 0;
    dispatch({ type: "context-change", contextKey });
  }, [contextKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { pollAbortRef.current?.abort(); };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    // Prevent duplicate starts for the same context, including clicks that
    // land before React re-renders with the updated phase.
    if (judgeStartBlocked(phaseRef.current)) return;
    phaseRef.current = "starting";

    const expectedContext = contextKey;
    pollCountRef.current = 0;
    dispatch({ type: "start", contextKey: expectedContext });

    try {
      const started = await startJudgeEvaluation({
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
      });
      // Context check: if changed while starting, discard
      dispatch({ type: "start-succeeded", taskId: started.taskId, contextKey: expectedContext });

      // Start polling
      const controller = new AbortController();
      pollAbortRef.current = controller;
      void pollJudgeLoop({
        taskId: started.taskId,
        expectedContext,
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
        signal: controller.signal,
      });
    } catch (error) {
      const e = error instanceof JudgeRequestError ? error : null;
      dispatch({
        type: "start-failed",
        message: error instanceof Error ? error.message : "Judge 评估启动失败",
        code: e?.code ?? "JUDGE_START_FAILED",
        contextKey: expectedContext,
      });
    }
  }, [contextKey, input.questionId, input.recordRevision]);

  const pollJudgeLoop = useCallback(async (args: {
    taskId: string;
    expectedContext: string;
    questionId: string;
    expectedRevision: number;
    signal: AbortSignal;
  }) => {
    while (pollCountRef.current < MAX_POLL_ATTEMPTS) {
      if (args.signal.aborted) return;

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (args.signal.aborted) return;

      pollCountRef.current++;
      try {
        const result = await pollJudgeTask({
          questionId: args.questionId,
          expectedRevision: args.expectedRevision,
          taskId: args.taskId,
          signal: args.signal,
        });

        if (result.status === "running") continue;

        // Completed — apply result (reducer drops it if the context changed)
        dispatch({ type: "poll-completed", result: result.result.judge, contextKey: args.expectedContext });
        return;
      } catch (error) {
        if (args.signal.aborted) return;
        const e = error instanceof JudgeRequestError ? error : null;
        dispatch({
          type: "poll-failed",
          message: error instanceof Error ? error.message : "Judge 评估任务失败",
          code: e?.code ?? "JUDGE_POLL_FAILED",
          contextKey: args.expectedContext,
        });
        return;
      }
    }
    // Max attempts reached
    dispatch({ type: "timeout", contextKey: args.expectedContext });
  }, []);

  const reset = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    pollCountRef.current = 0;
    dispatch({ type: "reset" });
  }, []);

  return { state, start, reset };
}
