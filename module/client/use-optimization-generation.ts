import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  startOptimizationGeneration,
  pollOptimizationTask,
  optimizationContextKey,
  OptimizationRequestError,
} from "./response-logic-optimization-client.js";
import type { OptimizationOutput } from "../contracts/response-logic-optimization.js";
import {
  createTaskLifecycleReducer,
  initialTaskLifecycleState,
  taskStartBlocked,
  type TaskLifecycleState,
} from "./task-lifecycle.js";

export type OptimizationPhase = "idle" | "starting" | "running" | "completed" | "failed";

export type OptimizationState = Omit<TaskLifecycleState<OptimizationOutput>, "activeContext">;

export const initialOptimizationLifecycleState = initialTaskLifecycleState<OptimizationOutput>();

const optimizationReducer = createTaskLifecycleReducer<OptimizationOutput>({
  timeoutCode: "OPTIMIZATION_TIMEOUT",
  timeoutMessage: "优化任务轮询超时（轮询次数达到上限）",
});

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100; // ~5 minutes

/**
 * Manages the LLM optimization task lifecycle with the same context
 * protection guarantees as the judge hook (shared state machine):
 *
 * The context key binds a task to questionId + revision + draft fingerprint +
 * judgeTaskId. Any context change (switched question, edited draft, new
 * evaluation) aborts polling and drops stale responses, so an old candidate
 * can never be applied to a new context. Duplicate starts are rejected until
 * the in-flight task settles into a terminal state.
 */
export function useOptimizationGeneration(input: {
  questionId: string;
  recordRevision: number;
  sourceFingerprint: string;
  judgeTaskId: string;
}) {
  const [state, dispatch] = useReducer(optimizationReducer, initialOptimizationLifecycleState);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollCountRef = useRef(0);
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;

  const contextKey = optimizationContextKey(
    input.questionId, input.recordRevision, input.sourceFingerprint, input.judgeTaskId,
  );

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
    if (taskStartBlocked(phaseRef.current)) return;
    if (!input.judgeTaskId) return; // no completed judge task → never start
    phaseRef.current = "starting";

    const expectedContext = contextKey;
    pollCountRef.current = 0;
    dispatch({ type: "start", contextKey: expectedContext });

    try {
      const started = await startOptimizationGeneration({
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
        judgeTaskId: input.judgeTaskId,
      });
      dispatch({ type: "start-succeeded", taskId: started.taskId, contextKey: expectedContext });

      const controller = new AbortController();
      pollAbortRef.current = controller;
      void pollOptimizationLoop({
        taskId: started.taskId,
        expectedContext,
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
        judgeTaskId: input.judgeTaskId,
        signal: controller.signal,
      });
    } catch (error) {
      const e = error instanceof OptimizationRequestError ? error : null;
      dispatch({
        type: "start-failed",
        message: error instanceof Error ? error.message : "优化任务启动失败",
        code: e?.code ?? "OPTIMIZATION_START_FAILED",
        contextKey: expectedContext,
      });
    }
  }, [contextKey, input.questionId, input.recordRevision, input.judgeTaskId]);

  const pollOptimizationLoop = useCallback(async (args: {
    taskId: string;
    expectedContext: string;
    questionId: string;
    expectedRevision: number;
    judgeTaskId: string;
    signal: AbortSignal;
  }) => {
    while (pollCountRef.current < MAX_POLL_ATTEMPTS) {
      if (args.signal.aborted) return;

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (args.signal.aborted) return;

      pollCountRef.current++;
      try {
        const result = await pollOptimizationTask({
          questionId: args.questionId,
          expectedRevision: args.expectedRevision,
          judgeTaskId: args.judgeTaskId,
          taskId: args.taskId,
          signal: args.signal,
        });

        if (result.status === "running") continue;

        // Completed — apply result (reducer drops it if the context changed)
        dispatch({ type: "poll-completed", result: result.result.optimization, contextKey: args.expectedContext });
        return;
      } catch (error) {
        if (args.signal.aborted) return;
        const e = error instanceof OptimizationRequestError ? error : null;
        dispatch({
          type: "poll-failed",
          message: error instanceof Error ? error.message : "优化任务失败",
          code: e?.code ?? "OPTIMIZATION_POLL_FAILED",
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
