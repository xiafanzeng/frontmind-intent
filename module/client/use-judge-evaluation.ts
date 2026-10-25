import { useCallback, useEffect, useRef, useState } from "react";
import {
  startJudgeEvaluation,
  pollJudgeTask,
  judgeContextKey,
  JudgeRequestError,
} from "./response-logic-judge-client.js";
import type { JudgeOutput } from "../contracts/response-logic-judge.js";

export type JudgePhase = "idle" | "starting" | "running" | "completed" | "failed";

export type JudgeState = {
  phase: JudgePhase;
  result: JudgeOutput | null;
  error: string;
  errorCode: string;
  taskId: string | null;
};

const initialState: JudgeState = { phase: "idle", result: null, error: "", errorCode: "", taskId: null };

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 100; // ~5 minutes

/**
 * Manages the LLM-as-Judge async task lifecycle with context protection.
 *
 * Context key (questionId + revision + fingerprint) guards against stale
 * results: before applying any poll response, the hook verifies that the
 * current context hasn't changed. If it has, the response is silently dropped.
 *
 * Polling stops on: completion, failure, context change, or max attempts.
 */
export function useJudgeEvaluation(input: {
  questionId: string;
  recordRevision: number;
  sourceFingerprint: string;
}) {
  const [state, setState] = useState<JudgeState>(initialState);
  const pollAbortRef = useRef<AbortController | null>(null);
  const activeContextRef = useRef<string>("");
  const pollCountRef = useRef(0);

  const contextKey = judgeContextKey(input.questionId, input.recordRevision, input.sourceFingerprint);

  // On context change: cancel polling, reset state
  useEffect(() => {
    if (activeContextRef.current !== contextKey) {
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
      pollCountRef.current = 0;
      activeContextRef.current = contextKey;
      // Don't reset if we're already idle for this context
      setState(prev => prev.phase === "idle" ? prev : initialState);
    }
  }, [contextKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { pollAbortRef.current?.abort(); };
  }, []);

  const start = useCallback(async (): Promise<void> => {
    // Prevent duplicate starts for the same context
    if (state.phase === "starting" || state.phase === "running") return;

    const expectedContext = judgeContextKey(input.questionId, input.recordRevision, input.sourceFingerprint);
    activeContextRef.current = expectedContext;
    pollCountRef.current = 0;

    setState({ phase: "starting", result: null, error: "", errorCode: "", taskId: null });

    try {
      const started = await startJudgeEvaluation({
        questionId: input.questionId,
        expectedRevision: input.recordRevision,
      });

      // Context check: if changed while starting, discard
      if (activeContextRef.current !== expectedContext) return;

      setState(prev => ({ ...prev, phase: "running", taskId: started.taskId }));

      // Start polling
      const controller = new AbortController();
      pollAbortRef.current = controller;
      pollJudgeLoop(started.taskId, expectedContext, controller.signal);
    } catch (error) {
      if (activeContextRef.current !== expectedContext) return;
      const e = error instanceof JudgeRequestError ? error : null;
      setState(prev => ({
        ...prev,
        phase: "failed",
        error: error instanceof Error ? error.message : "Judge 评估启动失败",
        errorCode: e?.code ?? "JUDGE_START_FAILED",
      }));
    }
  }, [input.questionId, input.recordRevision, input.sourceFingerprint, state.phase]);

  const pollJudgeLoop = useCallback(async (taskId: string, expectedContext: string, signal: AbortSignal) => {
    const input2 = { questionId: activeContextRef.current.split(":")[0], expectedRevision: Number(activeContextRef.current.split(":")[1]) };
    while (pollCountRef.current < MAX_POLL_ATTEMPTS) {
      if (signal.aborted) return;
      if (activeContextRef.current !== expectedContext) return;

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (signal.aborted) return;
      if (activeContextRef.current !== expectedContext) return;

      pollCountRef.current++;
      try {
        const result = await pollJudgeTask({
          questionId: input2.questionId,
          expectedRevision: input2.expectedRevision,
          taskId,
          signal,
        });

        if (activeContextRef.current !== expectedContext) return;

        if (result.status === "running") continue;

        // Completed — apply result
        setState(prev => ({
          ...prev,
          phase: "completed",
          result: result.result.judge,
          error: "",
          errorCode: "",
        }));
        return;
      } catch (error) {
        if (signal.aborted || activeContextRef.current !== expectedContext) return;
        const e = error instanceof JudgeRequestError ? error : null;
        setState(prev => ({
          ...prev,
          phase: "failed",
          error: error instanceof Error ? error.message : "Judge 评估任务失败",
          errorCode: e?.code ?? "JUDGE_POLL_FAILED",
        }));
        return;
      }
    }
    // Max attempts reached
    if (activeContextRef.current === expectedContext) {
      setState(prev => ({ ...prev, phase: "failed", error: "Judge 评估超时（轮询次数达到上限）", errorCode: "JUDGE_TIMEOUT" }));
    }
  }, []);

  const reset = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    pollCountRef.current = 0;
    setState(initialState);
  }, []);

  return { state, start, reset };
}
