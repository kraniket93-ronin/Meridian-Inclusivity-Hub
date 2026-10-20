// The model layer: what a hosted LLM is allowed to contribute, and what it can never
// touch. The merge functions here are the safety core, and they are pure so the rules
// are testable without a network.
//
// Division of labour, and the reason for it. The deterministic rule engine decides what
// something IS — the finding type, the criteria, the level, the severity, the gate. The
// model writes what it MEANS for the customer and what to do about it. The case asks for
// exactly that: "a checklist can catch a missing alt-tag... it cannot catch a form that
// is technically WCAG-compliant but still defeats a low-literacy user". Judgement about
// impact is the model's job; classification is not, because that is where over-claiming
// starts, and over-claiming is what the golden-set audit found in v0.
import { z } from "zod";

import type { FindingDraft } from "./guards";
import type { Remediation } from "./subagents";
import type { RuleResult } from "./rules";
import {
  diagnoseUserPrompt,
  diagnoserSystemPrompt,
  remediateUserPrompt,
  remediatorSystemPrompt,
  PROMPT_VERSION,
  type DiagnosePromptInput,
  type FewShotExample,
} from "./prompts";

/* ------------------------------------------------------------------ contracts */

/** JSON Schema sent to the provider, so the response is constrained at source. */
export const DIAGNOSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    evidence_context: { type: "string" },
    affected_user_need: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "evidence_context", "affected_user_need", "description"],
} as const;

export const REMEDIATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    recommended_fix: { type: "string" },
    fix_rationale: { type: "string" },
    verification_steps: { type: "string" },
  },
  required: ["recommended_fix", "fix_rationale", "verification_steps"],
} as const;

/** Re-validated locally: a provider promising a schema is not the same as keeping it. */
export const DiagnoseOutput = z
  .object({
    title: z.string().trim().min(8).max(160),
    evidence_context: z.string().trim().max(600),
    affected_user_need: z.string().trim().min(5).max(200),
    description: z.string().trim().min(10).max(900),
  })
  .strict();
export type DiagnoseOutput = z.infer<typeof DiagnoseOutput>;

export const RemediateOutput = z
  .object({
    recommended_fix: z.string().trim().min(10).max(1200),
    fix_rationale: z.string().trim().min(10).max(1200),
    verification_steps: z.string().trim().min(10).max(800),
  })
  .strict();
export type RemediateOutput = z.infer<typeof RemediateOutput>;

/* ------------------------------------------------------------------ merging */

/**
 * The model may rewrite the narrative. It may not change what the finding is.
 *
 * Everything the gate, the metrics or a regulator would read — finding type, criteria,
 * version, level, baseline status, severity, confidence, abstention reason, gate
 * recommendation, who reviews it, the priority score — is carried over from the rule
 * result untouched, whatever the model returned.
 *
 * The rule's own observation stays in `evidence` verbatim, with the model's context
 * appended, so a reader can always separate what was measured from what was inferred.
 */
export function mergeDiagnosis(draft: FindingDraft, model: DiagnoseOutput, rule: RuleResult): FindingDraft {
  const context = model.evidence_context.trim();
  return {
    ...draft,
    title: model.title.trim(),
    affected_user_need: model.affected_user_need.trim(),
    evidence: context ? `${rule.evidence} ${context}` : draft.evidence,
  };
}

/** The model's narrative, if any, for the finding's description field. */
export function diagnosisDescription(model: DiagnoseOutput): string {
  return model.description.trim();
}

export function mergeRemediation(fallback: Remediation, model: RemediateOutput): Remediation {
  return {
    recommendedFix: model.recommended_fix.trim(),
    rationale: model.fix_rationale.trim(),
    verificationSteps: model.verification_steps.trim(),
  };
}

/* ------------------------------------------------------------------ the model */

export interface ModelCallMeta {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  totalTokens: number | null;
  /** Set when the deterministic path was used instead, with the reason. */
  fellBackBecause: string | null;
}

export interface AgentModel {
  provider: string;
  diagnose(
    input: DiagnosePromptInput,
    examples: FewShotExample[],
  ): Promise<{ output: DiagnoseOutput | null; meta: ModelCallMeta }>;
  remediate(
    input: { rule: RuleResult; screenId: string; stepName: string; platform: string; fallback: Remediation },
    examples: FewShotExample[],
  ): Promise<{ output: RemediateOutput | null; meta: ModelCallMeta }>;
}

const deterministicMeta = (reason: string): ModelCallMeta => ({
  provider: "deterministic",
  model: "rule-engine",
  promptVersion: PROMPT_VERSION,
  latencyMs: 0,
  totalTokens: null,
  fellBackBecause: reason,
});

/** No hosted model: the agent still runs, on the rule-backed text. */
export const deterministicAgentModel: AgentModel = {
  provider: "deterministic",
  async diagnose() {
    return { output: null, meta: deterministicMeta("no model configured") };
  },
  async remediate() {
    return { output: null, meta: deterministicMeta("no model configured") };
  },
};

/**
 * Gemini. Every failure — not configured, HTTP error, timeout, invalid JSON, schema
 * violation — returns a null output with the reason recorded, and the caller falls back
 * to the rule-backed text. A model being unavailable degrades the prose; it never stops
 * a scan or changes a classification.
 */
export const geminiAgentModel: AgentModel = {
  provider: "gemini",

  async diagnose(input, examples) {
    const { callGemini } = await import("@/lib/ai/gemini.server");
    const result = await callGemini({
      system: diagnoserSystemPrompt(examples),
      input: diagnoseUserPrompt(input),
      schema: DIAGNOSE_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    if (!result.ok) {
      return {
        output: null,
        meta: {
          provider: "gemini",
          model: result.model,
          promptVersion: PROMPT_VERSION,
          latencyMs: result.latencyMs,
          totalTokens: null,
          fellBackBecause: result.error,
        },
      };
    }
    const parsed = DiagnoseOutput.safeParse(result.data);
    return {
      output: parsed.success ? parsed.data : null,
      meta: {
        provider: "gemini",
        model: result.model,
        promptVersion: PROMPT_VERSION,
        latencyMs: result.latencyMs,
        totalTokens: result.totalTokens,
        fellBackBecause: parsed.success
          ? null
          : `schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
      },
    };
  },

  async remediate(input, examples) {
    const { callGemini } = await import("@/lib/ai/gemini.server");
    const result = await callGemini({
      system: remediatorSystemPrompt(examples),
      input: remediateUserPrompt(input),
      schema: REMEDIATE_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    if (!result.ok) {
      return {
        output: null,
        meta: {
          provider: "gemini",
          model: result.model,
          promptVersion: PROMPT_VERSION,
          latencyMs: result.latencyMs,
          totalTokens: null,
          fellBackBecause: result.error,
        },
      };
    }
    const parsed = RemediateOutput.safeParse(result.data);
    return {
      output: parsed.success ? parsed.data : null,
      meta: {
        provider: "gemini",
        model: result.model,
        promptVersion: PROMPT_VERSION,
        latencyMs: result.latencyMs,
        totalTokens: result.totalTokens,
        fellBackBecause: parsed.success
          ? null
          : `schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
      },
    };
  },
};

/** Gemini when a key is present, the rule-backed path otherwise. */
export async function selectAgentModel(): Promise<AgentModel> {
  const { geminiIsConfigured } = await import("@/lib/ai/gemini.server");
  return geminiIsConfigured() ? geminiAgentModel : deterministicAgentModel;
}
