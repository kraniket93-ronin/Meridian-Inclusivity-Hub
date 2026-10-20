import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useDb, useCurrentActor, useService } from "@/domain/store";
import { DEMO_NOTE } from "@/domain/presentation";
import { CreateScanSchema } from "@/domain/schemas";
import { EmptyState, PageHeader, Panel, StatusBadge, fmtDate } from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/scans/")({
  head: () => ({
    meta: [
      { title: "Scans · Meridian Inclusive Access Agent" },
      { name: "description", content: "Create accessibility scans and track queued scan jobs." },
      { property: "og:title", content: "Scans · Meridian" },
      { property: "og:description", content: "Create accessibility scans and track scan jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScansPage,
});

function ScansPage() {
  const actor = useCurrentActor();
  const service = useService();
  const { scans, projects, scanJobs, findings } = useDb((s) => s);
  const [projectId, setProjectId] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const selectedProject = projectId || projects[0]?.id || "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = CreateScanSchema.safeParse({ projectId: selectedProject, targetUrl: url });
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setRunning(true);
    try {
      const id = await service.createScan(r.data.projectId, r.data.targetUrl);
      toast.success(`Scan ${id} completed — findings written to the database`);
      setUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageHeader title="Scans" description={DEMO_NOTE} />
      <p className="mb-5 text-sm">
        Meridian Mobile App — MVP journeys · Onboarding (12 steps) · Dispute filing (9 steps) ·
        Android, iOS, Web
      </p>
      {actor.role !== "viewer" && (
        <Panel title="Create scan (simulated)" className="mb-6">
          <form
            onSubmit={(e) => void submit(e)}
            noValidate
            className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="project">Project</Label>
              <Select value={selectedProject} onValueChange={setProjectId}>
                <SelectTrigger id="project" aria-invalid={!!errors["projectId"]}>
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="url">Staging build target</Label>
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Release 4.2 staging build"
                aria-invalid={!!errors["targetUrl"]}
                aria-describedby={errors["targetUrl"] ? "url-err" : undefined}
              />
              {errors["targetUrl"] && (
                <p id="url-err" className="text-sm text-destructive">
                  {errors["targetUrl"]}
                </p>
              )}
            </div>
            <Button type="submit" disabled={running}>
              {running ? "Running…" : "Queue scan"}
            </Button>
          </form>
        </Panel>
      )}
      {scans.length === 0 ? (
        <EmptyState title="No scans yet">Create your first scan above.</EmptyState>
      ) : (
        <div className="rounded-lg border bg-card shadow-card">
          <Table>
            <caption className="sr-only">All scans</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Scan</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scans.map((s) => {
                const job = scanJobs.find((j) => j.scanId === s.id);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        to="/scans/$scanId"
                        params={{ scanId: s.id }}
                        className="font-mono text-primary underline-offset-2 hover:underline"
                      >
                        {s.id}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs">
                      {s.targetUrl}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {job ? `${job.status} · ${job.progress}%` : "—"}
                    </TableCell>
                    <TableCell>{findings.filter((f) => f.scanId === s.id).length}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(s.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
