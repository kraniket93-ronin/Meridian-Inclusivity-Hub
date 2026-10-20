import { describe, expect, it } from "vitest";
import { SampleRequestSchema, safeRows } from "./sanitize";

describe("MAE dataset guardrails", () => {
  it("rejects the test split", () => {
    expect(SampleRequestSchema.safeParse({ split: "test" }).success).toBe(false);
  });
  it("allows the train split", () => {
    expect(SampleRequestSchema.safeParse({ split: "train", limit: 5 }).success).toBe(true);
  });
  it("caps samples at 25", () => {
    expect(SampleRequestSchema.safeParse({ split: "train", limit: 26 }).success).toBe(false);
  });
  it("strips ground-truth columns and drops test rows", () => {
    const out = safeRows([
      { id: 1, split: "train", html: "<img>", expected_findings: ["x"], ground_truth_label: "fail" },
      { id: 2, split: "test", html: "<a>" },
    ]);
    expect(out).toEqual([{ id: 1, split: "train", html: "<img>" }]);
  });
});
