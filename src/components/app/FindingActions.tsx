import { useState } from "react";
import { toast } from "sonner";
import { useCurrentActor, useService } from "@/domain/store";
import {
  allowedActions,
  canAct,
  REJECT_REASONS,
  validateRejection,
  type FindingAction,
  type RejectReason,
} from "@/domain/workflow";
import type { Finding } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const labels: Partial<Record<FindingAction, string>> = {
  approve: "Approve for remediation",
  reject: "Reject",
  send_compliance: "Send to Compliance",
  mark_ready: "Mark ready for verification",
};
export function FindingActions({ finding }: { finding: Finding }) {
  const actor = useCurrentActor();
  const service = useService();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<FindingAction | null>(null);
  if (finding.status === "awaiting_compliance")
    return <p className="font-medium">Waiting for Compliance decision</p>;
  if (actor.role === "viewer") return null;
  const actions = allowedActions(finding.status).filter(
    (action) => labels[action] && canAct(actor.role, action),
  );
  async function perform(action: FindingAction) {
    try {
      if (action === "reject") validateRejection(reason, note);
      setBusy(action);
      await service.transition(finding.id, action, note, reason);
      setRejecting(false);
      setError("");
      setNote("");
      setReason(undefined);
      toast.success(`${labels[action] ?? "Updated"} — saved`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            variant={action === "approve" ? "default" : "outline"}
            className="h-auto min-h-9 whitespace-normal"
            disabled={busy !== null}
            onClick={() => (action === "reject" ? setRejecting(true) : void perform(action))}
          >
            {busy === action ? "Saving…" : labels[action]}
          </Button>
        ))}
      </div>
      {rejecting && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void perform("reject");
          }}
          className="space-y-3"
          noValidate
        >
          <fieldset aria-describedby={error ? `reject-error-${finding.id}` : undefined}>
            <legend className="mb-2 text-sm font-medium">Rejection reason (required)</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {REJECT_REASONS.map((value) => (
                <Label
                  key={value}
                  className="flex items-center gap-2 font-normal"
                  htmlFor={`${finding.id}-${value}`}
                >
                  <input
                    id={`${finding.id}-${value}`}
                    type="radio"
                    name={`reason-${finding.id}`}
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                  />
                  {value.replaceAll("_", " ")}
                </Label>
              ))}
            </div>
          </fieldset>
          <Label htmlFor={`reject-note-${finding.id}`}>
            Reason details {reason === "other" ? "(required)" : "(optional)"}
          </Label>
          <Textarea
            id={`reject-note-${finding.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Submit rejection</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRejecting(false);
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <p
        id={`reject-error-${finding.id}`}
        role="alert"
        aria-live="assertive"
        className="text-sm text-destructive"
      >
        {error}
      </p>
    </div>
  );
}
