// The acceptance checklist for the MVP scenario, as a test. The same records are the
// seed for Postgres (scripts/gen_seed_sql.mjs reads this file's fixtures), so a drift
// between the spec and the database shows up here first.
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures";
import { wcagVerdict } from "./presentation";
import type { Finding } from "./types";

const findings = fixtures.findings;
const byId = (id: string) => findings.find((f) => f.id === id) as Finding;

describe("MVP scenario", () => {
  it("has exactly the eight golden-set findings on one scan", () => {
    expect(findings).toHaveLength(8);
    expect(new Set(findings.map((f) => f.scanId))).toEqual(new Set(["scn-2001"]));
    expect(findings.map((f) => f.id).sort()).toEqual(
      [
        "FND-0020",
        "FND-0048",
        "FND-0067",
        "FND-0099",
        "FND-0141",
        "FND-0199",
        "FND-0223",
        "FND-0297",
      ].sort(),
    );
  });

  it("covers all six finding types", () => {
    expect(new Set(findings.map((f) => f.findingType))).toEqual(
      new Set([
        "wcag_failure",
        "accessibility_usability_issue",
        "cognitive_load_issue",
        "language_inclusion_issue",
        "banking_policy_violation",
        "needs_expert_review",
      ]),
    );
  });

  it("answers 'is this a WCAG failure?' with Yes for exactly three findings", () => {
    const yes = findings.filter((f) => wcagVerdict(f).startsWith("Yes"));
    expect(yes.map((f) => f.id).sort()).toEqual(["FND-0048", "FND-0141", "FND-0199"]);
  });

  it("keeps the 38 dp target out of the WCAG baseline and explains why", () => {
    const f = byId("FND-0223");
    expect(f.findingType).toBe("accessibility_usability_issue");
    expect(wcagVerdict(f).startsWith("No")).toBe(true);
    expect(f.callout).toMatch(/38 dp/);
    expect(f.callout).toMatch(/2\.5\.8/);
  });

  it("abstains with a reason whenever confidence is low", () => {
    for (const f of findings.filter((x) => x.confidence === "low")) {
      expect(f.abstentionReason, f.id).toBeTruthy();
    }
    expect(byId("FND-0297").abstentionReason).toMatch(/text size is not recorded/i);
  });

  it("routes policy and language findings to Compliance and nowhere else", () => {
    for (const id of ["FND-0020", "FND-0067"]) {
      const f = byId(id);
      expect(f.status).toBe("awaiting_compliance");
      expect(f.escalateTo).toBe("Compliance");
      expect(f.gateRecommendation).toBe("escalate_to_compliance");
    }
  });

  it("requires human review for every expert, policy and language finding, and for any block", () => {
    for (const f of findings) {
      if (
        ["needs_expert_review", "banking_policy_violation", "language_inclusion_issue"].includes(
          f.findingType,
        ) ||
        f.gateRecommendation === "recommend_block_pending_human"
      ) {
        expect(f.requiresHumanReview, f.id).toBe(true);
      }
    }
  });

  it("names WCAG metadata on failures only", () => {
    for (const f of findings) {
      if (f.findingType === "wcag_failure") {
        expect(f.wcagCriteria?.length, f.id).toBeGreaterThan(0);
        expect(f.wcagVersion, f.id).toBeTruthy();
        expect(f.conformanceLevel, f.id).toBeTruthy();
      }
    }
  });

  it("starts with no verified fix and nothing verified by a machine", () => {
    expect(findings.filter((f) => f.status === "verified")).toHaveLength(0);
    expect(fixtures.verificationRuns).toHaveLength(0);
  });

  it("puts the three reviewable findings in the queue", () => {
    expect(fixtures.reviewTasks.map((t) => t.findingId).sort()).toEqual([
      "FND-0048",
      "FND-0099",
      "FND-0297",
    ]);
    for (const t of fixtures.reviewTasks) {
      expect(["in_review", "held_for_expert_review"]).toContain(byId(t.findingId).status);
    }
  });

  it("cites only policy sources that exist in the lookup table", () => {
    const known = new Set(fixtures.policySources.map((p) => p.id));
    for (const f of findings) {
      expect(f.policySources.length, f.id).toBeGreaterThan(0);
      for (const s of f.policySources) expect(known.has(s.id), `${f.id} → ${s.id}`).toBe(true);
    }
  });
});
