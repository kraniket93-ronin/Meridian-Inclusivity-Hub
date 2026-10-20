// React hooks for the agent: read the run log, start a run, and the three human actions
// that follow one. Mutations invalidate both the run log and the app state, so a draft
// promoted here shows up in the Findings Inbox without a reload.
//
// Not named *.client.ts on purpose: TanStack Start's import protection treats that
// pattern as client-only and refuses the import from a server-rendered route.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  fetchAgentRun,
  fetchAgentRuns,
  promoteDraft as promoteDraftFn,
  raiseJiraTicket as raiseJiraTicketFn,
  requestRetest as requestRetestFn,
  startAgentRun as startAgentRunFn,
  type AgentDraftSummary,
  type AgentRunSummary,
  type AgentStep,
} from "./agent.functions";
import { APP_STATE_KEY, DataFetchError, getCurrentActor } from "./store";
import type { DataResult } from "./data.functions";

export type { AgentDraftSummary, AgentRunSummary, AgentStep };

export const AGENT_RUNS_KEY = ["agent-runs"] as const;
export const agentRunKey = (runId: string) => ["agent-run", runId] as const;

function must<T>(result: DataResult<T>): T {
  if (!result.ok) throw new DataFetchError(result);
  return result.data;
}

function actorPayload() {
  const { name, role } = getCurrentActor();
  return { name, role };
}

export function useAgentRuns() {
  const list = useServerFn(fetchAgentRuns);
  return useQuery({
    queryKey: AGENT_RUNS_KEY,
    queryFn: async (): Promise<AgentRunSummary[]> => must(await list()),
    retry: false,
    staleTime: 2_000,
  });
}

export function useAgentRun(runId: string) {
  const read = useServerFn(fetchAgentRun);
  return useQuery({
    queryKey: agentRunKey(runId),
    queryFn: async () => must(await read({ data: { runId } })),
    retry: false,
    staleTime: 2_000,
  });
}

export function useAgentService() {
  const queryClient = useQueryClient();
  const start = useServerFn(startAgentRunFn);
  const promote = useServerFn(promoteDraftFn);
  const jira = useServerFn(raiseJiraTicketFn);
  const retest = useServerFn(requestRetestFn);

  const invalidate = useCallback(
    async (runId?: string) => {
      await queryClient.invalidateQueries({ queryKey: AGENT_RUNS_KEY });
      await queryClient.invalidateQueries({ queryKey: APP_STATE_KEY });
      if (runId) await queryClient.invalidateQueries({ queryKey: agentRunKey(runId) });
    },
    [queryClient],
  );

  return {
    async startRun(input: {
      journey: "onboarding" | "dispute_filing";
      platform: "android" | "ios" | "web";
      buildId: string;
      maxScreens: number;
    }) {
      const result = must(await start({ data: { ...input, actor: actorPayload() } }));
      await invalidate(result.runId);
      return result;
    },

    async promote(findingId: string, runId: string) {
      must(await promote({ data: { findingId, actor: actorPayload() } }));
      await invalidate(runId);
    },

    async raiseJira(findingId: string, runId: string) {
      const result = must(await jira({ data: { findingId, actor: actorPayload() } }));
      await invalidate(runId);
      return result;
    },

    async requestRetest(findingId: string, runId: string) {
      must(await retest({ data: { findingId, actor: actorPayload() } }));
      await invalidate(runId);
    },
  };
}
