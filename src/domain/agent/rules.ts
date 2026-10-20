// Deterministic rule engine. Pure functions over a screen record and its accessibility
// tree — no model, no I/O. The LLM may never overrule a result from here.
//
// Every rule carries the classification decisions the v0.1 audit settled: what is a WCAG
// A/AA failure, what is supplemental 2.2, what is AAA best practice, what is outside WCAG
// entirely, and what the recorded evidence simply cannot decide.
import type { BaselineStatus, FindingType, Severity } from "../types";

export interface A11yNode {
  id: string;
  role: string;
  name: string;
  focus_order?: number;
  visual_order?: number;
  interactive?: string;
  lang?: string;
  icon_only?: string;
  visible_label?: string;
}

/** A row of the golden set's `screens` table. Values arrive as strings. */
export interface ScreenRecord {
  screen_id: string;
  journey: string;
  step_no: string | number;
  step_name: string;
  step_type: string;
  platform: string;
  build_id: string;
  a11y_tree_json?: string;
  visible_text?: string;
  lang_attr_set?: string;
  rendered_language?: string;
  languages_required?: string;
  languages_available?: string;
  regulated_content?: string;
  min_contrast_ratio?: string;
  min_font_size_sp?: string;
  font_scaling_supported?: string;
  focus_indicator_visible?: string;
  live_region_status?: string;
  error_message_text?: string;
  otp_timeout_sec?: string;
  otp_timeout_extendable?: string;
  otp_focus_returns_to_first?: string;
  min_tap_target_dp?: string;
  liveness_methods?: string;
  reading_grade_fk?: string;
  asks_redundant_entry?: string;
  auth_factors_in_flow?: string;
  puzzle_alternative?: string;
  [key: string]: unknown;
}

export interface RuleResult {
  ruleId: string;
  title: string;
  findingType: FindingType;
  criteria: string[] | null;
  wcagVersion: string | null;
  conformanceLevel: "A" | "AA" | "AAA" | "A/AA" | null;
  baselineStatus: BaselineStatus;
  severity: Severity;
  confidence: "high" | "medium" | "low";
  abstentionReason: string | null;
  evidence: string;
  nodeIds?: string[];
  /** Key into app_citation_map: a WCAG criterion or a `topic:` key. */
  citationKeys: string[];
  affectedUserNeed: string;
  affectedGroups: string[];
  userImpact: "task_blocked" | "task_slowed";
  callout?: string;
  extraNote?: string;
}

const yes = (v: unknown) => String(v ?? "").trim().toUpperCase() === "Y";
const no = (v: unknown) => String(v ?? "").trim().toUpperCase() === "N";
const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};
const list = (v: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(v ?? "[]").replace(/'/g, '"'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export function parseTree(screen: ScreenRecord): A11yNode[] {
  try {
    const raw = screen.a11y_tree_json;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as A11yNode[]) : [];
  } catch {
    return [];
  }
}

const isAuthStep = (s: ScreenRecord) => s.step_type === "auth" || /otp|mpin|liveness|kyc/i.test(s.step_name);

type Rule = (screen: ScreenRecord, tree: A11yNode[]) => RuleResult | null;

/* ----------------------------------------------------------------- the rules */

const missingAccessibleName: Rule = (screen, tree) => {
  const unnamed = tree.filter((n) => yes(n.interactive) && !String(n.name ?? "").trim());
  if (!unnamed.length) return null;
  return {
    ruleId: "name-missing",
    title: `${unnamed.length} interactive control${unnamed.length > 1 ? "s have" : " has"} no accessible name`,
    findingType: "wcag_failure",
    criteria: ["4.1.2"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "A",
    baselineStatus: "in_baseline_2.1_AA",
    severity: isAuthStep(screen) ? "critical" : "high",
    confidence: "high",
    abstentionReason: null,
    evidence: `Interactive nodes with an empty name: ${unnamed.map((n) => `${n.id} (${n.role})`).join(", ")}.`,
    nodeIds: unnamed.map((n) => n.id),
    citationKeys: ["4.1.2"],
    affectedUserNeed: "Know what a control does before activating it",
    affectedGroups: ["Screen-reader users"],
    userImpact: isAuthStep(screen) ? "task_blocked" : "task_slowed",
  };
};

const focusOrder: Rule = (screen, tree) => {
  const ordered = tree
    .filter((n) => yes(n.interactive) && n.focus_order != null && n.visual_order != null)
    .sort((a, b) => (a.focus_order ?? 0) - (b.focus_order ?? 0));
  const offenders = ordered.filter((n, i) => i > 0 && (ordered[i - 1]!.visual_order ?? 0) > (n.visual_order ?? 0));
  if (!offenders.length) return null;
  return {
    ruleId: "focus-order",
    title: "Focus order does not follow the visual order",
    findingType: "wcag_failure",
    criteria: ["2.4.3"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "A",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "high",
    abstentionReason: null,
    evidence: `Focus moves out of reading order at: ${offenders
      .map((n) => `${n.id} (focus ${n.focus_order}, visually ${n.visual_order})`)
      .join(", ")}.`,
    nodeIds: offenders.map((n) => n.id),
    citationKeys: ["2.4.3"],
    affectedUserNeed: "Move through a form in a predictable order",
    affectedGroups: ["Screen-reader users", "Limited dexterity"],
    userImpact: "task_slowed",
  };
};

const otpFocusJump: Rule = (screen) => {
  if (!yes(screen.otp_focus_returns_to_first)) return null;
  return {
    ruleId: "otp-focus-jump",
    title: "OTP boxes lose focus after each digit",
    findingType: "wcag_failure",
    criteria: ["1.3.1", "2.4.3", "4.1.2"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "A",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "critical",
    confidence: "medium",
    abstentionReason: null,
    evidence:
      "Ungrouped digit boxes; focus returns to the first box after each digit, so the code can never be completed in order.",
    citationKeys: ["1.3.1", "2.4.3", "4.1.2"],
    affectedUserNeed: "Enter a one-time code with a screen reader",
    affectedGroups: ["Screen-reader users"],
    userImpact: "task_blocked",
  };
};

const languageOfPage: Rule = (screen) => {
  if (!no(screen.lang_attr_set)) return null;
  return {
    ruleId: "lang-attr",
    title: "Page language is not set programmatically",
    findingType: "wcag_failure",
    criteria: ["3.1.1"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "A",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "medium",
    confidence: "high",
    abstentionReason: null,
    evidence: `Rendered language is ${screen.rendered_language ?? "unknown"} but no language attribute is set.`,
    citationKeys: ["3.1.1"],
    affectedUserNeed: "Hear content pronounced in the right language",
    affectedGroups: ["Screen-reader users", "Non-English preference"],
    userImpact: "task_slowed",
  };
};

const contrast: Rule = (screen) => {
  const ratio = num(screen.min_contrast_ratio);
  if (ratio == null || ratio >= 4.5) return null;
  // Between 3:1 and 4.5:1 the outcome depends on text size, which the generator does
  // not record. Asserting a failure here is exactly the over-claiming to avoid.
  if (ratio >= 3.0) {
    return {
      ruleId: "contrast-indeterminate",
      title: `Text contrast ${ratio.toFixed(1)}:1 — needs expert review`,
      findingType: "needs_expert_review",
      criteria: ["1.4.3"],
      wcagVersion: "WCAG 2.0, in 2.1 baseline",
      conformanceLevel: "AA",
      baselineStatus: "in_baseline_2.1_AA",
      severity: "medium",
      confidence: "low",
      abstentionReason:
        "Contrast is between 3:1 and 4.5:1 and the text size is not recorded. Large text passes 1.4.3 at 3:1.",
      evidence: `Measured contrast ${ratio.toFixed(1)}:1; text size and weight are not recorded for this screen.`,
      citationKeys: ["1.4.3"],
      affectedUserNeed: "Read text with low vision or in bright light",
      affectedGroups: ["Low vision", "Seniors (60+)"],
      userImpact: "task_slowed",
    };
  }
  return {
    ruleId: "contrast-fail",
    title: `Text contrast ${ratio.toFixed(1)}:1 is below the AA minimum`,
    findingType: "wcag_failure",
    criteria: ["1.4.3"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "AA",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "high",
    abstentionReason: null,
    evidence: `Measured contrast ${ratio.toFixed(1)}:1, below 4.5:1 and below the 3:1 large-text threshold.`,
    citationKeys: ["1.4.3"],
    affectedUserNeed: "Read text with low vision or in bright light",
    affectedGroups: ["Low vision", "Seniors (60+)"],
    userImpact: "task_slowed",
  };
};

const resizeText: Rule = (screen) => {
  if (!no(screen.font_scaling_supported)) return null;
  const size = num(screen.min_font_size_sp);
  return {
    ruleId: "resize-text",
    title: "Text does not respond to the system font size",
    findingType: "wcag_failure",
    criteria: ["1.4.4"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "AA",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "high",
    abstentionReason: null,
    evidence: `Font scaling is not supported${size != null ? `; smallest text is ${size} sp` : ""}.`,
    citationKeys: ["1.4.4"],
    affectedUserNeed: "Enlarge text to a size I can read",
    affectedGroups: ["Low vision", "Seniors (60+)"],
    userImpact: "task_slowed",
  };
};

const focusVisible: Rule = (screen) => {
  if (!no(screen.focus_indicator_visible)) return null;
  return {
    ruleId: "focus-visible",
    title: "Keyboard focus is not visible",
    findingType: "wcag_failure",
    criteria: ["2.4.7"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "AA",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "high",
    abstentionReason: null,
    evidence: "No visible focus indicator is rendered for keyboard or switch users.",
    citationKeys: ["2.4.7"],
    affectedUserNeed: "See which control I am about to activate",
    affectedGroups: ["Limited dexterity", "Low vision"],
    userImpact: "task_slowed",
  };
};

const statusMessages: Rule = (screen) => {
  const live = String(screen.live_region_status ?? "").trim().toLowerCase();
  const hasError = Boolean(String(screen.error_message_text ?? "").trim());
  if (!hasError || (live && live !== "none")) return null;
  return {
    ruleId: "status-message",
    title: "Status change is not announced",
    findingType: "wcag_failure",
    criteria: ["4.1.3"],
    wcagVersion: "WCAG 2.1, in 2.1 baseline",
    conformanceLevel: "AA",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "high",
    abstentionReason: null,
    evidence: `The message "${screen.error_message_text}" appears without a live region.`,
    citationKeys: ["4.1.3"],
    affectedUserNeed: "Learn the result of an action without sight",
    affectedGroups: ["Screen-reader users"],
    userImpact: "task_slowed",
  };
};

const errorSuggestion: Rule = (screen) => {
  const text = String(screen.error_message_text ?? "").trim();
  if (!text) return null;
  // An error that names no field and suggests no correction, e.g. "Authentication error 308".
  const unhelpful = /error\s*\d+|invalid input|something went wrong|failed/i.test(text) && text.length < 60;
  if (!unhelpful) return null;
  return {
    ruleId: "error-suggestion",
    title: "Error message does not explain the problem",
    findingType: "wcag_failure",
    criteria: ["3.3.1", "3.3.3"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "A/AA",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "medium",
    abstentionReason: null,
    evidence: `Error text: "${text}". It names no field and suggests no correction.`,
    citationKeys: ["3.3.1", "3.3.3"],
    affectedUserNeed: "Know what went wrong and how to fix it",
    affectedGroups: ["Low digital literacy", "Cognitive disabilities"],
    userImpact: "task_slowed",
  };
};

const timingAdjustable: Rule = (screen) => {
  const seconds = num(screen.otp_timeout_sec);
  if (seconds == null || seconds >= 60 || yes(screen.otp_timeout_extendable)) return null;
  return {
    ruleId: "timeout",
    title: `One-time code expires after ${seconds} seconds and cannot be extended`,
    findingType: "wcag_failure",
    criteria: ["2.2.1"],
    wcagVersion: "WCAG 2.0, in 2.1 baseline",
    conformanceLevel: "A",
    baselineStatus: "in_baseline_2.1_AA",
    severity: "high",
    confidence: "medium",
    abstentionReason: null,
    evidence: `Timeout ${seconds}s, not extendable. A security exception may apply and must be assessed before the fix.`,
    citationKeys: ["2.2.1"],
    affectedUserNeed: "Finish entering a code without being timed out",
    affectedGroups: ["Seniors (60+)", "Cognitive disabilities", "Screen-reader users"],
    userImpact: "task_blocked",
  };
};

const tapTarget: Rule = (screen) => {
  const dp = num(screen.min_tap_target_dp);
  if (dp == null || dp >= 48) return null;
  // Under WCAG 2.1 only 2.5.5 applies and it is AAA; 2.2's 2.5.8 needs just 24 px.
  return {
    ruleId: "tap-target",
    title: `Touch target too small (${dp} dp)`,
    findingType: "accessibility_usability_issue",
    criteria: null,
    wcagVersion: null,
    conformanceLevel: null,
    baselineStatus: dp >= 24 ? "outside_AA_baseline" : "in_baseline_2.1_AA",
    severity: "medium",
    confidence: "high",
    abstentionReason: null,
    evidence: `Tappable controls measure ${dp} dp.`,
    citationKeys: ["topic:tap_target"],
    affectedUserNeed: "Tap controls accurately with limited dexterity or vision",
    affectedGroups: ["Seniors (60+)", "Limited dexterity"],
    userImpact: "task_slowed",
    callout: `Not a WCAG 2.1 AA failure. ${dp} dp passes WCAG 2.2 2.5.8 (24 px) and fails only WCAG 2.1 2.5.5 (AAA, 44 px). Reported against Android's 48 dp guidance.`,
  };
};

const languageCoverage: Rule = (screen) => {
  if (!yes(screen.regulated_content)) return null;
  const required = list(screen.languages_required);
  const available = list(screen.languages_available);
  const missing = required.filter((l) => !available.includes(l));
  if (!missing.length) return null;
  return {
    ruleId: "language-coverage",
    title: "Regulated content is missing a required language",
    findingType: "language_inclusion_issue",
    criteria: null,
    wcagVersion: null,
    conformanceLevel: null,
    baselineStatus: "outside_wcag",
    severity: "critical",
    confidence: "medium",
    abstentionReason: "Legal or regulatory conclusion reserved for Compliance.",
    evidence: `Regulated screen. Languages required: ${required.join(", ")}; available: ${available.join(", ")}. Missing: ${missing.join(", ")}.`,
    citationKeys: ["topic:language_coverage"],
    affectedUserNeed: "Read regulated content in a preferred language",
    affectedGroups: ["Non-English preference"],
    userImpact: "task_blocked",
    extraNote:
      "MAE reports this gap. Closing it is the localisation workstream's job, not the agent's: no WCAG criterion requires translation.",
  };
};

const livenessAlternative: Rule = (screen) => {
  const methods = list(screen.liveness_methods);
  if (!methods.length) return null;
  const hasAlternative = methods.some((m) => m !== "blink");
  if (hasAlternative) return null;
  return {
    ruleId: "liveness-blink-only",
    title: "Liveness check relies only on blinking",
    findingType: "banking_policy_violation",
    criteria: null,
    wcagVersion: null,
    conformanceLevel: null,
    baselineStatus: "outside_wcag",
    severity: "critical",
    confidence: "medium",
    abstentionReason: "Legal or regulatory conclusion reserved for Compliance.",
    evidence: `Liveness methods offered: ${methods.join(", ")}. No alternative to blinking on command is available.`,
    citationKeys: ["topic:liveness"],
    affectedUserNeed: "Complete identity verification with a disability",
    affectedGroups: ["Screen-reader users", "Low vision"],
    userImpact: "task_blocked",
    extraNote:
      "May conflict with the RBI KYC (2nd Amendment) Directions 2025; Compliance decides. The agent flags, it does not conclude.",
  };
};

const readingLevel: Rule = (screen) => {
  const grade = num(screen.reading_grade_fk);
  if (grade == null || grade < 11) return null;
  if (!yes(screen.regulated_content) && !/consent|declaration|dispute|loan/i.test(screen.step_name)) return null;
  return {
    ruleId: "reading-level",
    title: "Declaration text too complex",
    findingType: "cognitive_load_issue",
    criteria: ["3.1.5"],
    wcagVersion: "WCAG 2.0, in 2.1",
    conformanceLevel: "AAA",
    baselineStatus: "aaa_best_practice",
    severity: "medium",
    confidence: "medium",
    abstentionReason: null,
    evidence: `Reading grade about ${grade.toFixed(1)} on a regulated screen.`,
    citationKeys: ["topic:reading_level"],
    affectedUserNeed: "Understand financial terms and their consequences",
    affectedGroups: ["Cognitive disabilities", "Low digital literacy"],
    userImpact: "task_slowed",
  };
};

const redundantEntry: Rule = (screen) => {
  if (!yes(screen.asks_redundant_entry)) return null;
  return {
    ruleId: "redundant-entry",
    title: "The flow asks for information already given",
    findingType: "wcag_failure",
    criteria: ["3.3.7"],
    wcagVersion: "WCAG 2.2 (supplemental)",
    conformanceLevel: "A",
    baselineStatus: "supplemental_2.2",
    severity: "medium",
    confidence: "medium",
    abstentionReason: null,
    evidence:
      "The step re-asks for information entered earlier in the same journey. The essential and security exceptions in 3.3.7 have not been assessed.",
    citationKeys: ["3.3.7"],
    affectedUserNeed: "Avoid re-entering what I already provided",
    affectedGroups: ["Cognitive disabilities", "Seniors (60+)"],
    userImpact: "task_slowed",
  };
};

const authenticationLoad: Rule = (screen) => {
  const factors = num(screen.auth_factors_in_flow);
  if (factors == null || factors < 4) return null;
  return {
    ruleId: "auth-load",
    title: `Authentication chain runs to ${factors} steps`,
    findingType: "cognitive_load_issue",
    criteria: null,
    wcagVersion: null,
    conformanceLevel: null,
    baselineStatus: "outside_AA_baseline",
    severity: "medium",
    confidence: "medium",
    abstentionReason: null,
    evidence: `${factors} authentication steps in one flow. W3C does not treat multi-factor login as a 3.3.8 failure, so this is reported as cognitive load, not a conformance failure.`,
    citationKeys: ["topic:authentication"],
    affectedUserNeed: "Complete sign-in without holding several codes in memory",
    affectedGroups: ["Seniors (60+)", "Cognitive disabilities"],
    userImpact: "task_slowed",
    extraNote:
      "Any change to an authentication factor goes to Security. The agent never proposes removing one to reduce friction.",
  };
};

const cognitiveTest: Rule = (screen) => {
  if (!no(screen.puzzle_alternative)) return null;
  return {
    ruleId: "cognitive-test",
    title: "Puzzle step has no recorded alternative",
    findingType: "needs_expert_review",
    criteria: null,
    wcagVersion: null,
    conformanceLevel: null,
    baselineStatus: "outside_AA_baseline",
    severity: "medium",
    confidence: "low",
    abstentionReason:
      "The puzzle type is not recorded, and object-recognition puzzles are exempt at AA. 3.3.8 is WCAG 2.2, so it is supplemental here.",
    evidence: "A cognitive function test is present with no alternative recorded; the puzzle type is unknown.",
    citationKeys: ["topic:authentication"],
    affectedUserNeed: "Authenticate without solving a puzzle from memory",
    affectedGroups: ["Cognitive disabilities"],
    userImpact: "task_slowed",
  };
};

export const RULES: Rule[] = [
  missingAccessibleName,
  focusOrder,
  otpFocusJump,
  languageOfPage,
  contrast,
  resizeText,
  focusVisible,
  statusMessages,
  errorSuggestion,
  timingAdjustable,
  tapTarget,
  languageCoverage,
  livenessAlternative,
  readingLevel,
  redundantEntry,
  authenticationLoad,
  cognitiveTest,
];

export const RULE_COUNT = RULES.length;

/** Runs every rule against one screen. Order is stable, so a build reproduces exactly. */
export function runRules(screen: ScreenRecord): RuleResult[] {
  const tree = parseTree(screen);
  return RULES.map((rule) => {
    try {
      return rule(screen, tree);
    } catch {
      return null;
    }
  }).filter((r): r is RuleResult => r !== null);
}
