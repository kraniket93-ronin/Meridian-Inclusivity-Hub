import { z } from "zod";

/** Columns matching this pattern are ground truth and must never reach the browser. */
export const LABEL_KEY = /(label|expected|ground_?truth|gold|answer|target|verdict|is_violation|finding)/i;
export const FORBIDDEN_SPLIT = /(test|eval|holdout)/i;

export const SampleRequestSchema = z.object({
  split: z.string().trim().regex(/^[a-z0-9_-]{1,32}$/i, "Invalid split")
    .refine((s) => !FORBIDDEN_SPLIT.test(s), "Test/evaluation split is not available"),
  limit: z.number().int().min(1).max(25).default(10),
});

/** Defense in depth: strip label-like keys again even though the database already does. */
export function stripLabels(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !LABEL_KEY.test(k)));
}

export function safeRows(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => !FORBIDDEN_SPLIT.test(String(r["split"] ?? "")))
    .map(stripLabels);
}
