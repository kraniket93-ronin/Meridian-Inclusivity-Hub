import { z } from "zod";

/** Input contract sent to the server-side LLM adapter. Never contains secrets. */
export const RecommendationRequestSchema = z.object({
  findingId: z.string().min(1),
  ruleId: z.string().min(1),
  wcag: z.string().min(1),
  selector: z.string().min(1),
  snippet: z.string().max(4000),
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

/** Output contract every model response must satisfy before it is stored. */
export const RecommendationOutputSchema = z
  .object({
    summary: z.string().min(10).max(300),
    proposedFix: z.string().min(1).max(4000),
    rationale: z.string().min(10).max(1500),
    confidence: z.number().min(0).max(1),
    // A WCAG criterion (1.3.1) or a policy-corpus chunk id (P003). Nothing else is citable.
    policyRefs: z.array(z.string().regex(/^(\d\.\d\.\d+|P\d{3})$/)).min(1),
    // The model may only *suggest*; it can never set status.
  })
  .strict();
export type RecommendationOutput = z.infer<typeof RecommendationOutputSchema>;

export const CreateScanSchema = z.object({
  projectId: z.string().min(1, "Choose a project"),
  targetUrl: z.string().trim().min(3, "Enter the staging build target"),
});

export const VerificationInputSchema = z.object({
  method: z.enum(["manual", "automated_rescan", "assistive_tech"]),
  result: z.enum(["pass", "fail"]),
  verifiedBy: z.string().trim().min(2, "Enter the verifier's name"),
  notes: z.string().trim().min(5, "Describe how it was checked"),
});
