import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import type { DbState, Role } from "./types";
import { emptyState } from "./mappers";
import {
  createScan as createScanFn,
  fetchAppState,
  recordVerification as recordVerificationFn,
  resetDemoData as resetDemoDataFn,
  runScan as runScanFn,
  saveFailedModelRun as saveFailedModelRunFn,
  saveRecommendation as saveRecommendationFn,
  transitionFinding as transitionFindingFn,
  type DataError,
  type DataResult,
} from "./data.functions";
import type { RejectReason, FindingAction } from "./workflow";

/* -------------------------------------------------------------- demo identity */

export const CURRENT_USER = "Aniket Kumar (Demo reviewer)";
export interface DemoActor {
  name: string;
  role: Role;
  isDemo: boolean;
}
const defaultActor: DemoActor = { name: CURRENT_USER, role: "reviewer", isDemo: true };
let actor = defaultActor;
const identityListeners = new Set<() => void>();

export function setCurrentActor(next: DemoActor) {
  actor = next;
  identityListeners.forEach((l) => l());
}
export function getCurrentActor(): DemoActor {
  return actor;
}
export function useCurrentActor(): DemoActor {
  return useSyncExternalStore(
    (l) => {
      identityListeners.add(l);
      return () => identityListeners.delete(l);
    },
    () => actor,
    () => defaultActor,
  );
}

/* -------------------------------------------------------------- reads */

export const APP_STATE_KEY = ["app-state"] as const;

// One stable empty snapshot: selectors run against the same object reference while
// the first fetch is in flight, so no page re-renders itself into a loop.
const EMPTY_STATE: DbState = emptyState();

export class DataFetchError extends Error {
  code: DataError;
  constructor(result: Extract<DataResult<unknown>, { ok: false }>) {
    super(result.message);
    this.name = "DataFetchError";
    this.code = result.error;
  }
}

export function useAppState() {
  const fetchState = useServerFn(fetchAppState);
  return useQuery({
    queryKey: APP_STATE_KEY,
    queryFn: async (): Promise<DbState> => {
      const result = await fetchState();
      if (!result.ok) throw new DataFetchError(result);
      return result.data;
    },
    retry: false,
    staleTime: 2_000,
  });
}

/** Same signature the pages already use; the data now comes from Postgres. */
export function useDb<T>(selector: (s: DbState) => T): T {
  const query = useAppState();
  return selector(query.data ?? EMPTY_STATE);
}

export function useDataStatus() {
  const query = useAppState();
  const error = query.error instanceof DataFetchError ? query.error : null;
  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    code: error?.code ?? null,
    message: error?.message ?? null,
    refetch: query.refetch,
  };
}

/* -------------------------------------------------------------- writes */

function actorPayload() {
  const { name, role } = getCurrentActor();
  return { name, role };
}

/** Turns a server result into a thrown Error, so callers can keep try/catch. */
function must<T>(result: DataResult<T>): T {
  if (!result.ok) throw new DataFetchError(result);
  return result.data;
}

export function useService() {
  const queryClient = useQueryClient();
  const transition = useServerFn(transitionFindingFn);
  const verify = useServerFn(recordVerificationFn);
  const create = useServerFn(createScanFn);
  const run = useServerFn(runScanFn);
  const reset = useServerFn(resetDemoDataFn);
  const saveRec = useServerFn(saveRecommendationFn);
  const saveFailed = useServerFn(saveFailedModelRunFn);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
    [queryClient],
  );

  return {
    invalidate,

    async transition(
      findingId: string,
      action: FindingAction,
      note?: string,
      reason?: RejectReason,
    ) {
      must(
        await transition({
          data: {
            findingId,
            action,
            actor: actorPayload(),
            ...(note ? { note } : {}),
            ...(reason ? { reason } : {}),
          },
        }),
      );
      await invalidate();
    },

    async recordVerification(
      findingId: string,
      input: {
        method: "manual" | "automated_rescan" | "assistive_tech";
        result: "pass" | "fail";
        notes: string;
      },
    ) {
      must(await verify({ data: { findingId, ...input, actor: actorPayload() } }));
      await invalidate();
    },

    /** Queues a scan, then runs the worker. Both write real rows. */
    async createScan(projectId: string, targetUrl: string) {
      const { scanId } = must(
        await create({ data: { projectId, targetUrl, actor: actorPayload() } }),
      );
      await invalidate();
      must(await run({ data: { scanId, actor: actorPayload() } }));
      await invalidate();
      return scanId;
    },

    async resetDemoData() {
      must(await reset({ data: { actor: actorPayload() } }));
      await invalidate();
    },

    async saveRecommendation(
      findingId: string,
      output: {
        summary: string;
        proposedFix: string;
        rationale: string;
        confidence: number;
        policyRefs: string[];
      },
      runMeta: { provider: string; model: string; latencyMs: number; promptVersion: string },
    ) {
      must(await saveRec({ data: { findingId, ...output, run: runMeta, actor: actorPayload() } }));
      await invalidate();
    },

    async saveFailedModelRun(
      findingId: string,
      runMeta: { provider: string; model: string; latencyMs: number; promptVersion: string },
    ) {
      must(await saveFailed({ data: { findingId, run: runMeta } }));
      await invalidate();
    },
  };
}

/** Convenience for components that only need a mutation's pending state. */
export function useAppMutation<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<unknown>) {
  return useMutation({ mutationFn: (args: TArgs) => fn(...args) });
}
