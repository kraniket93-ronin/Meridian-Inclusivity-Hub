import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCurrentActor, useDb, useService } from "@/domain/store";
import { VerificationInputSchema } from "@/domain/schemas";
import { EmptyState, PageHeader, Panel, StatusBadge, fmtDate } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/verification")({
  head: () => ({
    meta: [
      { title: "Verification · Meridian" },
      { name: "description", content: "Record human verification of remediated findings." },
      { property: "og:title", content: "Verification · Meridian" },
      { property: "og:description", content: "Human verification records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Verification,
});

function VerifyForm({ findingId }: { findingId: string }) {
  const actor = useCurrentActor();
  const service = useService();
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"manual" | "automated_rescan" | "assistive_tech">(
    "assistive_tech",
  );
  const [busy, setBusy] = useState(false);
  const canVerify = actor.role === "reviewer" || actor.role === "admin";
  const submit = async (result: "pass" | "fail") => {
    const r = VerificationInputSchema.safeParse({ method, result, verifiedBy: actor.name, notes });
    if (!r.success) {
      toast.error(r.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      await service.recordVerification(findingId, { method, result, notes });
      toast.success(
        result === "pass" ? "Verified — recorded against your name" : "Sent back for remediation",
      );
      setNotes("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor={`by-${findingId}`}>Verifier (human)</Label>
        <p id={`by-${findingId}`} className="rounded-md border bg-muted px-3 py-2 text-sm">
          {actor.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Taken from the signed-in identity — it cannot be typed in, and no AI actor can be recorded
          here.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`m-${findingId}`}>Method</Label>
        <select
          id={`m-${findingId}`}
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="assistive_tech">Assistive technology test</option>
          <option value="manual">Manual</option>
          <option value="automated_rescan">Automated rescan</option>
        </select>
      </div>
      <div className="space-y-1 md:col-span-3">
        <Label htmlFor={`n-${findingId}`}>What was tested (required)</Label>
        <Textarea
          id={`n-${findingId}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Entered the OTP with TalkBack on Android 14: focus stayed in place and each digit was announced."
        />
      </div>
      {canVerify ? (
        <div className="flex gap-2 md:col-span-3">
          <Button disabled={busy} onClick={() => void submit("pass")}>
            {busy ? "Saving…" : "Pass"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void submit("fail")}>
            Fail
          </Button>
        </div>
      ) : (
        <p className="md:col-span-3 text-sm text-muted-foreground">
          Your demo role cannot record verification. Switch to reviewer or admin in Settings.
        </p>
      )}
    </div>
  );
}

function Verification() {
  const db = useDb((s) => s);
  const ready = db.findings.filter((f) => f.status === "ready_for_verification");
  return (
    <>
      <PageHeader
        title="Verification"
        description="Only a named human with a passing check can verify a fix. AI suggestions never count."
      />
      <div className="space-y-4">
        {ready.length === 0 ? (
          <EmptyState title="Nothing awaiting verification" />
        ) : (
          ready.map((f) => (
            <Panel key={f.id} title={f.title}>
              <p className="text-xs text-muted-foreground">
                {f.selector} · {f.pageUrl}
              </p>
              <VerifyForm findingId={f.id} />
            </Panel>
          ))
        )}
        <Panel title="Verification records">
          <ul className="divide-y text-sm">
            {db.verificationRuns.map((v) => (
              <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {v.findingId} · {v.verifiedBy} · {v.method.replace("_", " ")}
                </span>
                <span className="flex gap-2">
                  <StatusBadge status={v.result} />
                  {fmtDate(v.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
