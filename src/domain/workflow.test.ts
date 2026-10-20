import { describe, expect, it } from "vitest";
import { canMarkVerified, deterministicRules, nextStatus } from "./workflow";
import { RecommendationOutputSchema } from "./schemas";
import type { Finding } from "./types";

const f = { status: "ready_for_verification" } as Finding;

describe("verification rules", () => {
  it("rejects verification by an AI actor", () => {
    expect(canMarkVerified(f, { result: "pass", verifiedBy: "ai" }).ok).toBe(false);
  });
  it("allows a human pass", () => {
    expect(canMarkVerified(f, { result: "pass", verifiedBy: "Maya Chen" }).ok).toBe(true);
  });
  it("cannot verify straight from open", () => {
    expect(() => nextStatus("open", "verify_pass")).toThrow();
  });
});

describe("scan engine", () => {
  it("is deterministic", () => {
    const u = "https://a.test/x";
    expect(deterministicRules(u).map((r) => r.ruleId)).toEqual(deterministicRules(u).map((r) => r.ruleId));
  });
});

describe("LLM output schema", () => {
  it("rejects model output that tries to set status", () => {
    expect(RecommendationOutputSchema.safeParse({ summary: "Add alt text here", proposedFix: "x", rationale: "Because SC 1.1.1", confidence: 0.9, policyRefs: ["1.1.1"], status: "verified" }).success).toBe(false);
  });
});
