import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Link2,
  Loader2,
  Rocket,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type FleetProjectStats,
  type FleetRollup,
  generateWeeklyFleetMarkdown,
  getFleetRollup,
  isTauriAvailable,
  linkAllReposToFleet,
  type LinkAllResult,
  pushChangelogEntry,
  type WeeklyFleetMarkdown,
  type WindowReport,
} from "@/lib/tauri-ipc";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtPct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function accelerationColor(delta: number): string {
  if (delta >= 50) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (delta > 0) return "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  if (delta > -20) return "border-slate-500/40 bg-slate-500/10 text-slate-300";
  return "border-red-500/40 bg-red-500/10 text-red-200";
}

export default function Fleet() {
  const [rollup, setRollup] = useState<FleetRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Weekly report state
  const [report, setReport] = useState<WeeklyFleetMarkdown | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pushTarget, setPushTarget] = useState<string>("");
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<string | null>(null);

  // Bulk-link state
  const [linking, setLinking] = useState(false);
  const [linkResult, setLinkResult] = useState<LinkAllResult | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await getFleetRollup();
      setRollup(r);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleGenerateReport = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setReportLoading(true);
    setPushed(null);
    try {
      const r = await generateWeeklyFleetMarkdown();
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReportLoading(false);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [report]);

  const handlePushChangelog = useCallback(async () => {
    if (!report || !pushTarget) return;
    setPushing(true);
    setError(null);
    try {
      await pushChangelogEntry({
        project_id: pushTarget,
        title: `Fleet weekly report · ${new Date().toISOString().slice(0, 10)}`,
        content: report.markdown,
        type: "improvement",
        published: false,
      });
      setPushed(pushTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushing(false);
    }
  }, [report, pushTarget]);

  const handleLinkAll = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setLinking(true);
    setError(null);
    setLinkResult(null);
    try {
      const r = await linkAllReposToFleet();
      setLinkResult(r);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinking(false);
    }
  }, [refresh]);

  const linkedProjects = useMemo(
    () => rollup?.projects.filter((p) => p.linked) ?? [],
    [rollup],
  );
  const unlinkedProjects = useMemo(
    () => rollup?.projects.filter((p) => !p.linked) ?? [],
    [rollup],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-20">
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Rocket size={22} className="text-[var(--cv-accent)]" />
              <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
              <Badge
                variant="outline"
                className="border-cyan-500/40 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-[var(--cv-accent)]"
              >
                Cross-project
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
              Every fleet project, side by side. Linked repos (mapped via
              SaaS Maker project slug ↔ local path) run intel attribution
              locally; unlinked projects are listed so you can link them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleLinkAll}
              disabled={linking}
              title="Match every indexed local repo to a fleet project by name and save the links"
            >
              {linking ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Link2 size={14} className="mr-1.5" />
              )}
              Link all repos
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <Sparkles size={14} className="mr-1.5" />
              )}
              Refresh
            </Button>
          </div>
        </header>

        {linkResult && (
          <div className="mb-4 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-300" />
              Linked {linkResult.linked.length} of {linkResult.scanned_repo_count}{" "}
              local repos
              {linkResult.unmatched_repo_count > 0
                ? ` · ${linkResult.unmatched_repo_count} unmatched`
                : ""}
            </div>
            {linkResult.git_url_supported ? (
              <p className="mt-1 text-xs text-cyan-200/80">
                Backfilled git_url onto {linkResult.backfilled_count} project
                {linkResult.backfilled_count === 1 ? "" : "s"} on the fleet spine.
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-200/90">
                Saved locally only — the SaaS Maker API doesn&apos;t expose{" "}
                <span className="font-mono">git_url</span> yet, so nothing was
                written to the spine. Merge &amp; deploy{" "}
                <span className="font-mono">feat/projects-git-url</span> to enable
                fleet-wide backfill.
              </p>
            )}
            {linkResult.linked.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {linkResult.linked.map((l) => (
                  <span
                    key={l.repo_path}
                    className="rounded-full border border-cyan-500/30 bg-[var(--bg-raised)] px-2 py-0.5 font-mono text-[10px] text-cyan-100"
                    title={l.repo_path}
                  >
                    {l.project_name}
                    {l.backfilled ? " ✓" : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="font-mono text-xs">{error}</div>
          </div>
        )}

        {/* Linked projects table */}
        <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp size={16} className="text-[var(--cv-accent)]" />
              Linked projects ({linkedProjects.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Sorted by 30-day commit volume. AI acceleration compares
              commits/day after first AI-co-authored commit vs before.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Loader2 size={14} className="animate-spin" /> Reading git
                logs across the fleet…
              </div>
            ) : linkedProjects.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                {rollup?.error
                  ? "Couldn't pull fleet projects — sign in via Settings → Integrations → SaaS Maker."
                  : 'No linked projects yet. Open `/review` → pick a repo, then `Linked to <project>` populates automatically (or use the "set" button on Settings).'}
              </p>
            ) : (
              <LinkedProjectsTable rows={linkedProjects} />
            )}
          </CardContent>
        </Card>

        {/* Weekly report card */}
        <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send size={16} className="text-[var(--cv-accent)]" />
              Weekly fleet report
            </CardTitle>
            <CardDescription className="text-xs">
              One markdown summary across every linked project. Copy it to
              your editor, or push it directly as a SaaS Maker changelog
              entry on the project of your choice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleGenerateReport}
                disabled={reportLoading}
              >
                {reportLoading ? (
                  <>
                    <Loader2 size={12} className="mr-1.5 animate-spin" />
                    Building…
                  </>
                ) : (
                  <>
                    <Sparkles size={12} className="mr-1.5" />
                    Generate
                  </>
                )}
              </Button>
              {report && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8"
                >
                  {copied ? (
                    <>
                      <ClipboardCheck size={12} className="mr-1.5 text-emerald-300" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Clipboard size={12} className="mr-1.5" />
                      Copy markdown
                    </>
                  )}
                </Button>
              )}
              {report && linkedProjects.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={pushTarget}
                    onChange={(e) => setPushTarget(e.target.value)}
                    className="h-8 rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 font-mono text-[10px] text-slate-200"
                  >
                    <option value="">push to project…</option>
                    {linkedProjects.map((p) => (
                      <option key={p.project.id} value={p.project.id}>
                        {p.project.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handlePushChangelog}
                    disabled={pushing || !pushTarget}
                    className="h-8"
                  >
                    {pushing ? (
                      <Loader2 size={12} className="mr-1.5 animate-spin" />
                    ) : pushed === pushTarget ? (
                      <CheckCircle2 size={12} className="mr-1.5 text-emerald-300" />
                    ) : (
                      <Send size={12} className="mr-1.5" />
                    )}
                    Push
                  </Button>
                </div>
              )}
            </div>
            {report && (
              <div className="space-y-2">
                <div className="flex items-baseline gap-3 text-xs text-[var(--text-secondary)]">
                  <span>
                    <span className="font-mono text-[var(--text-primary)]">
                      {report.project_count}
                    </span>{" "}
                    projects
                  </span>
                  <span>
                    <span className="font-mono text-[var(--text-primary)]">
                      {report.total_commits}
                    </span>{" "}
                    commits
                  </span>
                  <span>
                    <span className="font-mono text-[var(--cv-accent)]">
                      {report.total_ai_commits}
                    </span>{" "}
                    AI · {fmtPct(report.total_ai_commits, report.total_commits)}
                  </span>
                </div>
                <pre className="max-h-96 overflow-auto rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3 font-mono text-[10px] text-slate-200">
                  {report.markdown}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unlinked projects */}
        {unlinkedProjects.length > 0 && (
          <Card className="border-[var(--cv-line)] bg-[var(--bg-surface)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Unlinked fleet projects ({unlinkedProjects.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Visible in SaaS Maker but no local repo mapped yet. Open one
                in <span className="font-mono">/review</span> or{" "}
                <span className="font-mono">/intel</span> and CodeVetter auto-links via{" "}
                <span className="font-mono">git remote origin</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {unlinkedProjects.map((p) => (
                  <div
                    key={p.project.id}
                    className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-3 py-2 text-xs"
                  >
                    <div className="truncate font-medium">{p.project.name}</div>
                    <div className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
                      {p.project.slug ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}

function LinkedProjectsTable({ rows }: { rows: FleetProjectStats[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--cv-line)] text-[var(--text-secondary)]">
            <th className="px-3 py-2 text-left font-normal">project</th>
            <th className="px-3 py-2 text-right font-normal">7d</th>
            <th className="px-3 py-2 text-right font-normal">30d</th>
            <th className="px-3 py-2 text-right font-normal">90d</th>
            <th className="px-3 py-2 text-right font-normal">all time</th>
            <th className="px-3 py-2 text-right font-normal">AI %</th>
            <th className="px-3 py-2 text-right font-normal">AI velocity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ProjectRow key={r.project.id} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectRow({ row }: { row: FleetProjectStats }) {
  const total30 = row.w30d?.total_commits ?? 0;
  const ai30 = row.w30d?.ai_commits ?? 0;
  return (
    <tr className="border-b border-[var(--cv-line)]/40 last:border-0">
      <td className="px-3 py-1.5">
        <div className="font-medium text-slate-100">{row.project.name}</div>
        <div className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
          {row.repo_path ?? "—"}
        </div>
        {row.error && (
          <div className="mt-0.5 font-mono text-[10px] text-amber-300/80">
            {row.error}
          </div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right">
        <WindowMini w={row.w7d} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <WindowMini w={row.w30d} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <WindowMini w={row.w90d} />
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        {fmtNum(row.all_time?.total_commits ?? 0)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-[var(--cv-accent)]">
        {fmtPct(ai30, total30)}
      </td>
      <td className="px-3 py-1.5 text-right">
        {row.acceleration ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={`font-mono text-[10px] ${accelerationColor(row.acceleration.velocity_delta_pct)}`}
              >
                {row.acceleration.velocity_delta_pct > 0 ? "+" : ""}
                {row.acceleration.velocity_delta_pct}%
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-[10px]">
              <div>First AI commit: {row.acceleration.first_ai_commit_date}</div>
              <div>
                Before: {row.acceleration.before_commits_per_day.toFixed(2)}/day
                over {row.acceleration.before_day_count}d
              </div>
              <div>
                After: {row.acceleration.after_commits_per_day.toFixed(2)}/day
                over {row.acceleration.after_day_count}d
              </div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-[10px] text-[var(--text-secondary)]">—</span>
        )}
      </td>
    </tr>
  );
}

function WindowMini({ w }: { w: WindowReport | null }) {
  if (!w) return <span className="text-[10px] text-[var(--text-secondary)]">—</span>;
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-xs">{w.total_commits}</div>
      <div className="font-mono text-[9px] text-[var(--text-secondary)]">
        {w.ai_commits} AI
      </div>
    </div>
  );
}
