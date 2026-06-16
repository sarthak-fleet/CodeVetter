import {
  AlertTriangle,
  Bot,
  FolderOpen,
  GitCommit,
  HelpCircle,
  Loader2,
  Sparkles,
  Users,
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
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  attributeRepoCommits,
  type AuthorRow,
  detectProjectForRepo,
  type FileChurn,
  getPreference,
  getPricingTable,
  getToolBreakdown,
  isTauriAvailable,
  pickDirectory,
  type PricingRow,
  type RepoAttributionReport,
  type RepoDetectResult,
  setPreference,
  type ToolBreakdownRow,
  type WindowReport,
} from "@/lib/tauri-ipc";

const REPO_PATH_KEY = "intel_last_repo";
const WINDOW_KEY = "intel_last_window";

type Range = "7" | "30" | "90" | "all";

const RANGE_OPTIONS: Array<{ value: Range; label: string; days: number | null }> = [
  { value: "7", label: "7d", days: 7 },
  { value: "30", label: "30d", days: 30 },
  { value: "90", label: "90d", days: 90 },
  { value: "all", label: "All", days: null },
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function rangeToDays(w: Range): number | null {
  return w === "all" ? null : Number.parseInt(w, 10);
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function fmtPct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function fmtSeconds(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

const TOOL_COLORS: Record<string, string> = {
  "claude-code": "#7dd3fc",
  codex: "#a78bfa",
  cursor: "#facc15",
  devin: "#fb923c",
  aider: "#34d399",
  windsurf: "#22d3ee",
  human: "#475569",
  automation: "#374151",
  grok: "#94a3b8",
  unknown: "#6b7280",
};

function toolColor(tool: string): string {
  return TOOL_COLORS[tool] ?? "#6b7280";
}

function prettyTool(tool: string): string {
  switch (tool) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "devin":
      return "Devin";
    case "aider":
      return "Aider";
    case "windsurf":
      return "Windsurf";
    case "human":
      return "Human";
    case "automation":
      return "Automation";
    case "grok":
      return "Grok";
    default:
      return tool;
  }
}

export default function Intel() {
  const [repoPath, setRepoPath] = useState("");
  const [range, setRange] = useState<Range>("30");
  const [detectedFleetProject, setDetectedFleetProject] =
    useState<RepoDetectResult | null>(null);
  const [attribution, setAttribution] = useState<RepoAttributionReport | null>(null);
  const [breakdown, setBreakdown] = useState<ToolBreakdownRow[]>([]);
  const [pricing, setPricing] = useState<PricingRow[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    void (async () => {
      try {
        const last = await getPreference(REPO_PATH_KEY);
        if (last) setRepoPath(last);
        const w = (await getPreference(WINDOW_KEY)) as Range | null;
        if (w && RANGE_OPTIONS.some((o) => o.value === w)) setRange(w);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    void (async () => {
      try {
        const rows = await getPricingTable();
        setPricing(rows);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const persistRepoPath = useCallback(async (p: string) => {
    if (!isTauriAvailable()) return;
    try {
      await setPreference(REPO_PATH_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const persistRange = useCallback(async (w: Range) => {
    if (!isTauriAvailable()) return;
    try {
      await setPreference(WINDOW_KEY, w);
    } catch {
      /* ignore */
    }
  }, []);

  // Fleet auto-detect: surfaces a "Linked to <Project>" line when the picked
  // repo matches a fleet project (via git URL or saved local mapping).
  useEffect(() => {
    if (!repoPath || !isTauriAvailable()) {
      setDetectedFleetProject(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await detectProjectForRepo(repoPath);
        if (!cancelled) setDetectedFleetProject(r);
      } catch {
        if (!cancelled) setDetectedFleetProject(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    void (async () => {
      if (!cancelled) setBreakdownLoading(true);
      try {
        const rows = await getToolBreakdown(rangeToDays(range));
        if (!cancelled) setBreakdown(rows);
      } catch {
        if (!cancelled) setBreakdown([]);
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const handlePick = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Intel requires the desktop app.");
      return;
    }
    const picked = await pickDirectory("Select a repository to analyze");
    if (picked) {
      setRepoPath(picked);
      void persistRepoPath(picked);
    }
  }, [persistRepoPath]);

  const handleRun = useCallback(async () => {
    if (!repoPath.trim()) {
      setError("Pick a repo first.");
      return;
    }
    if (!isTauriAvailable()) {
      setError("Attribution requires the desktop app.");
      return;
    }
    setError(null);
    setAttrLoading(true);
    try {
      const report = await attributeRepoCommits(repoPath);
      setAttribution(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setAttribution(null);
    } finally {
      setAttrLoading(false);
    }
  }, [repoPath]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-20">
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={22} className="text-[var(--cv-accent)]" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Engineering Intelligence
              </h1>
              <Badge
                variant="outline"
                className="border-cyan-500/40 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-[var(--cv-accent)]"
              >
                Personal
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
              How much of your recent code was AI-led vs. human-led, who shipped
              what, and where your LLM spend actually goes. Computed locally
              from your existing git history and indexed agent sessions.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>Tool window:</span>
            <RangePicker
              value={range}
              onChange={(w) => {
                setRange(w);
                void persistRange(w);
              }}
            />
          </div>
        </header>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Couldn&apos;t finish that.</div>
              <div className="mt-0.5 font-mono text-xs text-red-300/80">
                {error}
              </div>
            </div>
          </div>
        )}

        <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCommit size={16} className="text-[var(--cv-accent)]" />
              Repo Attribution
            </CardTitle>
            <CardDescription className="text-xs">
              Single <span className="font-mono">git log</span> pass; classifies
              commits via Co-Authored-By trailers and known AI tool markers;
              splits into <span className="font-mono">All / 90d / 30d / 7d</span>{" "}
              windows so the trend is visible at a glance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={repoPath}
                placeholder="/Users/me/code/my-repo"
                onChange={(e) => {
                  setRepoPath(e.target.value);
                  void persistRepoPath(e.target.value);
                }}
                disabled={attrLoading}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePick}
                disabled={attrLoading}
              >
                <FolderOpen size={14} className="mr-1.5" />
                Pick…
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleRun}
                disabled={attrLoading || !repoPath.trim()}
              >
                {attrLoading ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Sparkles size={14} className="mr-1.5" />
                )}
                Run
              </Button>
            </div>

            {detectedFleetProject?.project && (
              <div className="flex items-center gap-1.5 rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 text-[10px] text-cyan-300">
                <Sparkles size={11} className="shrink-0" />
                Linked to{" "}
                <span className="font-mono">
                  {detectedFleetProject.project.name}
                </span>
                <span className="text-cyan-500/60">·</span>
                <span className="text-cyan-500/60">
                  {detectedFleetProject.source === "git_url" ? "auto" : "manual"}
                </span>
              </div>
            )}

            {attribution ? (
              <AttributionResult report={attribution} />
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                {attrLoading
                  ? "Reading git log…"
                  : "Pick a repo and hit Run. First pass on a real repo of yours is a good baseline."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-[var(--cv-line)] bg-[var(--bg-surface)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot size={16} className="text-[var(--cv-accent)]" />
              Per-Tool LLM Usage
              <PricingTooltip pricing={pricing} />
            </CardTitle>
            <CardDescription className="text-xs">
              Rollup of every locally indexed Claude / Codex / Cursor session
              from <span className="font-mono">cc_sessions</span>, grouped by
              tool, with model split, cache creation tokens, and cost
              percentiles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {breakdownLoading ? (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : breakdown.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">
                No indexed sessions in this window. Trigger an index from the
                Home tab if you expected data here.
              </p>
            ) : (
              <ToolBreakdownGrid rows={breakdown} />
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function RangePicker({
  value,
  onChange,
}: {
  value: Range;
  onChange: (w: Range) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-1 text-xs">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            value === opt.value
              ? "rounded bg-cyan-500/10 px-2.5 py-1 font-medium text-[var(--cv-accent)]"
              : "rounded px-2.5 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Attribution sections ──────────────────────────────────────────────────

function AttributionResult({ report }: { report: RepoAttributionReport }) {
  return (
    <div className="space-y-6">
      <WindowsTable windows={report.windows} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DailySparkline series={report.daily_series} />
        <DayOfWeekChart histogram={report.day_of_week} />
      </div>

      <AuthorsSection authors={report.by_author} />
      <TopFilesSection files={report.top_files} />
    </div>
  );
}

function WindowsTable({ windows }: { windows: WindowReport[] }) {
  // Order: all, 90d, 30d, 7d
  const ordered = ["all", "90d", "30d", "7d"]
    .map((label) => windows.find((w) => w.label === label))
    .filter((w): w is WindowReport => Boolean(w));

  if (ordered.length === 0) return null;

  const rows: Array<{ label: string; value: (w: WindowReport) => string }> = [
    { label: "commits", value: (w) => fmtNum(w.total_commits) },
    {
      label: "AI",
      value: (w) =>
        `${fmtNum(w.ai_commits)} · ${fmtPct(w.ai_commits, w.ai_commits + w.human_commits)}`,
    },
    {
      label: "human",
      value: (w) =>
        `${fmtNum(w.human_commits)} · ${fmtPct(w.human_commits, w.ai_commits + w.human_commits)}`,
    },
    {
      label: "AI lines",
      value: (w) => `+${fmtNum(w.ai_additions)} / −${fmtNum(w.ai_deletions)}`,
    },
    {
      label: "human lines",
      value: (w) =>
        `+${fmtNum(w.human_additions)} / −${fmtNum(w.human_deletions)}`,
    },
    { label: "active days", value: (w) => String(w.active_days) },
    { label: "bots", value: (w) => String(w.automation_commits) },
  ];

  return (
    <div className="overflow-hidden rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--cv-line)]">
            <th className="px-3 py-2 text-left font-normal text-[var(--text-secondary)]">
              metric
            </th>
            {ordered.map((w) => (
              <th
                key={w.label}
                className="px-3 py-2 text-right font-mono font-medium uppercase tracking-wide text-[var(--cv-accent)]"
              >
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-[var(--cv-line)]/40 last:border-0">
              <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                {r.label}
              </td>
              {ordered.map((w) => (
                <td key={w.label} className="px-3 py-1.5 text-right font-mono">
                  {r.value(w)}
                </td>
              ))}
            </tr>
          ))}

          {/* tool mix row spans the same columns with stacked bars */}
          <tr>
            <td className="px-3 py-2 text-[var(--text-secondary)] align-top">
              tool mix
            </td>
            {ordered.map((w) => (
              <td key={w.label} className="px-3 py-2">
                <ToolMixBar window={w} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ToolMixBar({ window: w }: { window: WindowReport }) {
  const total = w.ai_commits + w.human_commits;
  const filtered = w.by_tool.filter((t) => t.tool !== "automation");
  if (total === 0 || filtered.length === 0) {
    return <div className="text-right text-[10px] text-[var(--text-secondary)]">—</div>;
  }
  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
        {filtered.map((t) => {
          const pct = (t.commits / total) * 100;
          return (
            <Tooltip key={t.tool}>
              <TooltipTrigger asChild>
                <div
                  className="h-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: toolColor(t.tool),
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                {prettyTool(t.tool)}: {t.commits} · +{fmtNum(t.additions)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="text-right text-[10px] font-mono text-[var(--text-secondary)]">
        {filtered
          .slice(0, 2)
          .map((t) => `${prettyTool(t.tool)} ${t.commits}`)
          .join(" · ")}
      </div>
    </div>
  );
}

function DailySparkline({ series }: { series: RepoAttributionReport["daily_series"] }) {
  // Bucket the 90-day series into ~30 buckets for visual clarity.
  const buckets = useMemo(() => {
    const target = 30;
    const perBucket = Math.max(1, Math.ceil(series.length / target));
    const out: Array<{ ai: number; human: number; label: string }> = [];
    for (let i = 0; i < series.length; i += perBucket) {
      const slice = series.slice(i, i + perBucket);
      out.push({
        ai: slice.reduce((s, d) => s + d.ai_commits, 0),
        human: slice.reduce((s, d) => s + d.human_commits, 0),
        label: slice[0]?.date ?? "",
      });
    }
    return out;
  }, [series]);

  const max = Math.max(1, ...buckets.map((b) => b.ai + b.human));

  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3">
      <div className="cv-label mb-2">AI vs human — last 90 days</div>
      <div className="flex h-16 items-end gap-[2px]">
        {buckets.map((b, i) => {
          const total = b.ai + b.human;
          const heightPct = (total / max) * 100;
          const aiPct = total === 0 ? 0 : (b.ai / total) * heightPct;
          const humanPct = heightPct - aiPct;
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className="flex flex-1 flex-col justify-end overflow-hidden rounded-sm bg-[var(--bg-surface)]"
                  style={{ minWidth: "4px" }}
                >
                  {humanPct > 0 && (
                    <div
                      className="bg-slate-500/60"
                      style={{ height: `${humanPct}%` }}
                    />
                  )}
                  {aiPct > 0 && (
                    <div
                      className="bg-[var(--cv-accent)]"
                      style={{ height: `${aiPct}%` }}
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                {b.label}: AI {b.ai} / human {b.human}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function DayOfWeekChart({ histogram }: { histogram: number[] }) {
  const max = Math.max(1, ...histogram);
  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3">
      <div className="cv-label mb-2">Commits by day of week (all time)</div>
      <div className="flex h-16 items-end gap-1">
        {histogram.map((n, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div className="flex flex-1 flex-col items-center justify-end">
                <div
                  className="w-full rounded-sm bg-[var(--cv-accent)]/70"
                  style={{ height: `${(n / max) * 100}%`, minHeight: "2px" }}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {WEEKDAY_LABELS[i]}: {n} commits
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-[var(--text-secondary)]">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="flex-1 text-center">
            {d}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthorsSection({ authors }: { authors: AuthorRow[] }) {
  if (authors.length === 0) return null;
  return (
    <div>
      <div className="cv-label mb-2 flex items-center gap-1.5">
        <Users size={12} />
        Top contributors (all time)
      </div>
      <div className="overflow-hidden rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--cv-line)] text-[var(--text-secondary)]">
              <th className="px-3 py-2 text-left font-normal">author</th>
              <th className="px-3 py-2 text-right font-normal">commits</th>
              <th className="px-3 py-2 text-right font-normal">AI</th>
              <th className="px-3 py-2 text-right font-normal">human</th>
              <th className="px-3 py-2 text-right font-normal">+lines</th>
              <th className="px-3 py-2 text-right font-normal">−lines</th>
              <th className="px-3 py-2 text-right font-normal">days</th>
              <th className="px-3 py-2 text-right font-normal">last</th>
              <th className="px-3 py-2 text-left font-normal">tool mix</th>
            </tr>
          </thead>
          <tbody>
            {authors.map((a) => {
              const totalNonAuto = a.ai_commits + a.human_commits;
              return (
                <tr
                  key={a.email || a.name}
                  className="border-b border-[var(--cv-line)]/40 last:border-0"
                >
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{a.name || "(unknown)"}</div>
                    <div className="font-mono text-[10px] text-[var(--text-secondary)]">
                      {a.email || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {a.commits.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--cv-accent)]">
                    {a.ai_commits} ({fmtPct(a.ai_commits, totalNonAuto)})
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {a.human_commits}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    +{fmtNum(a.additions)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    −{fmtNum(a.deletions)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {a.active_days}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--text-secondary)]">
                    {a.last_commit}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                      {a.tool_mix
                        .filter((t) => t.tool !== "automation")
                        .map((t) => {
                          const total = totalNonAuto || 1;
                          const pct = (t.commits / total) * 100;
                          return (
                            <Tooltip key={t.tool}>
                              <TooltipTrigger asChild>
                                <div
                                  className="h-full"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: toolColor(t.tool),
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-[10px]">
                                {prettyTool(t.tool)}: {t.commits}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopFilesSection({ files }: { files: FileChurn[] }) {
  if (files.length === 0) return null;
  const max = Math.max(1, ...files.map((f) => f.additions + f.deletions));
  return (
    <div>
      <div className="cv-label mb-2">Top files by churn (all time)</div>
      <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3">
        <div className="space-y-1.5">
          {files.map((f) => {
            const churn = f.additions + f.deletions;
            const pct = (churn / max) * 100;
            return (
              <div key={f.path} className="flex items-center gap-3 text-xs">
                <div
                  className="h-2 shrink-0 rounded-sm bg-[var(--cv-accent)]/60"
                  style={{ width: `${Math.max(2, pct * 0.6)}%` }}
                />
                <span className="flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">
                  {f.path}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                  +{fmtNum(f.additions)} / −{fmtNum(f.deletions)} · {f.commits}{" "}
                  commits
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tool breakdown grid ────────────────────────────────────────────────────

function ToolBreakdownGrid({ rows }: { rows: ToolBreakdownRow[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((r) => (
        <ToolCard key={r.tool} row={r} />
      ))}
    </div>
  );
}

function ToolCard({ row }: { row: ToolBreakdownRow }) {
  const maxDailyCost = Math.max(1, ...row.daily_cost.map((d) => d.cost_usd));
  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: toolColor(row.tool) }}
          />
          <span className="text-sm font-semibold">{prettyTool(row.tool)}</span>
          <span className="text-xs text-[var(--text-secondary)]">
            {row.sessions.toLocaleString()} sessions
          </span>
        </div>
        <span className="font-mono text-sm">{fmtUsd(row.estimated_cost_usd)}</span>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-[var(--text-secondary)]">
        <div>
          <div className="cv-label">input</div>
          <div className="font-mono text-[11px] text-[var(--text-primary)]">
            {fmtTokens(row.real_input_tokens)}
          </div>
        </div>
        <div>
          <div className="cv-label">output</div>
          <div className="font-mono text-[11px] text-[var(--text-primary)]">
            {fmtTokens(row.output_tokens)}
          </div>
        </div>
        <div>
          <div className="cv-label text-emerald-400/80">cache read</div>
          <div className="font-mono text-[11px] text-emerald-200">
            {fmtTokens(row.cache_read_tokens)}
          </div>
        </div>
        <div>
          <div className="cv-label text-amber-400/80">cache write</div>
          <div className="font-mono text-[11px] text-amber-200">
            {fmtTokens(row.cache_creation_tokens)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
        <span>
          avg session: <span className="font-mono">{fmtSeconds(row.avg_session_seconds)}</span>
        </span>
        <span>
          p50: <span className="font-mono">{fmtUsd(row.cost_p50_usd)}</span>{" · "}
          p95: <span className="font-mono">{fmtUsd(row.cost_p95_usd)}</span>
        </span>
      </div>

      {row.models.length > 0 && (
        <div className="mt-3">
          <div className="cv-label mb-1.5">model split</div>
          <div className="space-y-1">
            {row.models.map((m) => (
              <div
                key={m.model}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="font-mono text-[var(--text-secondary)]">
                  {m.model}
                </span>
                <span className="font-mono text-[var(--text-secondary)]">
                  {m.sessions} · {fmtUsd(m.estimated_cost_usd)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {row.daily_cost.some((d) => d.cost_usd > 0) && (
        <div className="mt-3">
          <div className="cv-label mb-1.5">
            $ over time ({row.daily_cost.length}d)
          </div>
          <div className="flex h-8 items-end gap-[2px]">
            {row.daily_cost.map((d, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <div
                    className="flex-1 rounded-sm bg-[var(--cv-accent)]/50"
                    style={{
                      height: `${(d.cost_usd / maxDailyCost) * 100}%`,
                      minHeight: "1px",
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  {d.date}: {fmtUsd(d.cost_usd)}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PricingTooltip({ pricing }: { pricing: PricingRow[] }) {
  if (pricing.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ml-1 text-[var(--text-secondary)] hover:text-[var(--cv-accent)]"
        >
          <HelpCircle size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-md text-[10px]">
        <div className="mb-1 font-semibold text-[var(--cv-accent)]">
          Per-million-token pricing
        </div>
        <table className="w-full font-mono">
          <thead>
            <tr className="text-[var(--text-secondary)]">
              <th className="pr-2 text-left font-normal">model</th>
              <th className="pr-2 text-right font-normal">in</th>
              <th className="pr-2 text-right font-normal">out</th>
              <th className="pr-2 text-right font-normal">cache R</th>
              <th className="pr-2 text-right font-normal">cache W</th>
            </tr>
          </thead>
          <tbody>
            {pricing.map((p) => (
              <tr key={p.model}>
                <td className="pr-2">{p.model}</td>
                <td className="pr-2 text-right">${p.input_per_mtok}</td>
                <td className="pr-2 text-right">${p.output_per_mtok}</td>
                <td className="pr-2 text-right">${p.cache_read_per_mtok}</td>
                <td className="pr-2 text-right">${p.cache_write_per_mtok}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[9px] text-[var(--text-secondary)]">
          Cost = base_input × in + output × out + cache_read × R + cache_write × W
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

