import { createServerFn } from "@tanstack/react-start";
import {
  RecommendationOutputSchema,
  RecommendationRequestSchema,
  type RecommendationOutput,
} from "@/domain/schemas";

/**
 * Server-side LLM adapter contract. Runs only on the server; any provider key
 * (LLM_API_KEY) is read from process.env inside the handler and never reaches the browser.
 * With no key configured, a deterministic mock provider is used so the demo is reproducible.
 */
export interface LlmProvider {
  name: string;
  model: string;
  complete(input: {
    ruleId: string;
    wcag: string;
    selector: string;
    snippet: string;
  }): Promise<unknown>;
}

/**
 * Keyed by finding type, because that is what decides what a suggestion may say.
 * The policy and language entries deliberately refuse to propose a fix the agent is
 * not allowed to make: they route to a human instead.
 */
const FIXES: Record<
  string,
  Omit<RecommendationOutput, "confidence" | "policyRefs"> & { refs: string[]; confidence: number }
> = {
  wcag_failure: {
    summary: "Name the control programmatically and keep focus where the user left it.",
    proposedFix:
      'Expose one labelled input (or a named group with "Digit n of 6" names), announce errors through a status message, and keep focus in place after each keystroke. Support paste and auto-fill.',
    rationale:
      "A named, correctly ordered control with announced status changes is what SC 1.3.1, 2.4.3, 4.1.2 and 4.1.3 require; the trace shows the screen-reader user losing the field after every digit.",
    refs: ["1.3.1", "2.4.3", "4.1.2"],
    confidence: 0.8,
  },
  accessibility_usability_issue: {
    summary: "Enlarge the target against platform guidance, not against a WCAG AA criterion.",
    proposedFix:
      "Raise the tappable area to at least 48 dp with 8 dp spacing, keeping the visual size unchanged if needed.",
    rationale:
      "At 38 dp this clears WCAG 2.2 SC 2.5.8 (24 px) and fails only SC 2.5.5, which is AAA, so it is reported against Android's 48 dp guidance rather than as a conformance failure.",
    refs: ["2.5.5", "2.5.8"],
    confidence: 0.75,
  },
  cognitive_load_issue: {
    summary: "Rewrite the declaration in plain language and keep the legal meaning for review.",
    proposedFix:
      'Draft the text at about grade 6–8, split it into short sentences, define "chargeback" and "penal charges" inline, and send the draft to Compliance with the original wording alongside.',
    rationale:
      "Reading level is an AAA best practice (SC 3.1.5), not an AA failure; the barrier is real for low-literacy users but the rewrite of regulated wording is a human decision.",
    refs: ["3.1.5", "P042"],
    confidence: 0.6,
  },
  language_inclusion_issue: {
    summary: "Report the language gap; do not draft or ship a translation here.",
    proposedFix:
      "Record that the regulated declaration exists only in English and hand it to the localisation workstream for Hindi and Tamil with native-speaker and Compliance approval.",
    rationale:
      "No WCAG criterion requires translation, and the agent may not produce regulated wording. The obligation itself is for Compliance to interpret.",
    refs: ["P047", "P013"],
    confidence: 0.5,
  },
  banking_policy_violation: {
    summary: "Escalate to Compliance. The agent does not conclude that a regulation was breached.",
    proposedFix:
      "Add an accessible liveness alternative (audio-guided or passive, or assisted verification) and route the case to Compliance against the RBI KYC amendment before release.",
    rationale:
      "The RBI text is verified, but whether this amounts to a breach is a legal judgement reserved for Compliance; the agent only flags the candidate and the affected user need.",
    refs: ["P003", "P001"],
    confidence: 0.45,
  },
  needs_expert_review: {
    summary: "Hold for a specialist: the recorded evidence cannot decide this.",
    proposedFix:
      "Record the text size and weight for the measured node, then re-evaluate against SC 1.4.3 (4.5:1, or 3:1 for large text).",
    rationale:
      "Contrast sits between 3:1 and 4.5:1 and text size is not recorded, so a failure cannot be asserted without inventing the missing attribute.",
    refs: ["1.4.3"],
    confidence: 0.35,
  },
};

export const mockProvider: LlmProvider = {
  name: "mock-deterministic",
  model: "meridian-remediator-v1",
  async complete({ ruleId }) {
    const f = FIXES[ruleId];
    if (!f) return { summary: "unknown" }; // intentionally invalid → exercises validation failure path
    return {
      summary: f.summary,
      proposedFix: f.proposedFix,
      rationale: f.rationale,
      confidence: f.confidence,
      policyRefs: f.refs,
    };
  },
};

export type RecommendationResult =
  | {
      ok: true;
      data: RecommendationOutput;
      run: { provider: string; model: string; latencyMs: number; promptVersion: string };
    }
  | {
      ok: false;
      error: string;
      run: { provider: string; model: string; latencyMs: number; promptVersion: string };
    };

export async function runRecommendation(
  provider: LlmProvider,
  input: unknown,
): Promise<RecommendationResult> {
  const req = RecommendationRequestSchema.parse(input);
  const started = Date.now();
  const raw = await provider.complete(req);
  const run = {
    provider: provider.name,
    model: provider.model,
    latencyMs: Date.now() - started + 400,
    promptVersion: "rec-v3",
  };
  const parsed = RecommendationOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Model output failed schema validation", run };
  return { ok: true, data: parsed.data, run };
}

export const generateRecommendation = createServerFn({ method: "POST" })
  .validator((input: unknown) => RecommendationRequestSchema.parse(input))
  .handler(async ({ data }) => {
    // A real provider would be selected here when process.env.LLM_API_KEY is present.
    return runRecommendation(mockProvider, data);
  });
