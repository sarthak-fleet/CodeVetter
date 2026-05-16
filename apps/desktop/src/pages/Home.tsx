import {
  Activity,
  BarChart3,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  AccountUsage,
  IndexStats,
  LiveUsageResult,
  ProviderAccount,
  TokenUsageStats,
  TriggerIndexResult,
} from "@/lib/tauri-ipc";
import {
  checkAccountUsage,
  checkLiveUsage,
  deleteProviderAccount,
  detectProviderAccounts,
  getIndexStats,
  getTokenUsageStats,
  isTauriAvailable,
  listProviderAccounts,
  triggerIndex,
} from "@/lib/tauri-ipc";

// ─── Usage helpers ──────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function planLabel(plan: string | null): string {
  if (!plan) return "";
  const labels: Record<string, string> = {
    max: "Max",
    pro: "Pro",
    prolite: "Pro",
    plus: "Plus",
    team: "Team",
    teams: "Team",
    enterprise: "Enterprise",
    business: "Business",
    free: "Free",
    go: "Go",
  };
  return labels[plan.toLowerCase()] ?? plan;
}

function formatDuration(secs: number): string {
  if (secs <= 0) return "now";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function UsageBar({
  pct,
  label,
  resetLabel,
  color,
  windowTotalSecs,
  resetsInSecs,
}: {
  pct: number;
  label: string;
  resetLabel?: string;
  color: "amber" | "red";
  windowTotalSecs?: number;
  resetsInSecs?: number;
}) {
  const colorMap = {
    amber: {
      fill: "linear-gradient(90deg, #8f6b28 0%, #d6a947 58%, #f2c766 100%)",
      text: "text-[#f0bf5b]",
      track: "rgba(214, 169, 71, 0.11)",
      glow: "0 0 16px rgba(214, 169, 71, 0.18)",
    },
    red: {
      fill: "linear-gradient(90deg, #9f2e2d 0%, #e44c3f 58%, #ff7a59 100%)",
      text: "text-[#ff725f]",
      track: "rgba(228, 76, 63, 0.12)",
      glow: "0 0 18px rgba(228, 76, 63, 0.22)",
    },
  };
  const c = colorMap[color];

  // Reserve / deplete calculation
  // on-track % = (elapsed / total) * 100 — if actual < on-track → in reserve
  let paceLabel: string | null = null;
  let paceColor = "text-slate-500";
  if (windowTotalSecs && resetsInSecs != null && resetsInSecs > 0) {
    const elapsed = windowTotalSecs - resetsInSecs;
    const onTrackPct = (elapsed / windowTotalSecs) * 100;
    const delta = Math.abs(onTrackPct - pct);
    if (pct < onTrackPct - 0.5) {
      paceLabel = `${Math.round(delta)}% in reserve`;
      paceColor = "text-emerald-400/80";
    } else if (pct > onTrackPct + 0.5) {
      paceLabel = `${Math.round(delta)}% ahead of pace`;
      paceColor = "text-[#ff725f]/90";
    } else {
      paceLabel = "on pace";
      paceColor = "text-slate-500";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-[12px] font-semibold tabular-nums ${c.text}`}>
            {Math.round(pct)}% used
          </span>
          {paceLabel && (
            <span className={`text-[10px] tabular-nums ${paceColor}`}>
              {paceLabel}
            </span>
          )}
          {resetLabel && (
            <span className="text-[10px] text-slate-600 tabular-nums">
              {resetLabel}
            </span>
          )}
        </div>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: c.track }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: c.fill,
            boxShadow: c.glow,
          }}
        />
      </div>
    </div>
  );
}

function AccountUsageRow({
  account,
  usage,
  liveUsage,
  onCheckLive,
  checkingLive,
  onDelete: _onDelete,
  isSharedUsage,
}: {
  account: ProviderAccount;
  usage: AccountUsage | null;
  liveUsage: LiveUsageResult | null;
  onCheckLive: () => void;
  checkingLive: boolean;
  onDelete: () => void;
  isSharedUsage: boolean;
}) {
  const weekSessions = usage?.week_sessions ?? 0;
  const weekTokens = (usage?.week_input_tokens ?? 0) + (usage?.week_output_tokens ?? 0);
  const profileBreakdown = usage?.profile_breakdown ?? [];
  const plan = usage?.plan ?? account.plan;

  // Live rate limit data — supported for all providers now
  const isLiveSupported = ["anthropic", "openai", "google"].includes(account.provider);
  const hasLive = liveUsage?.supported === true;
  const fiveH = liveUsage?.five_h;
  const sevenD = liveUsage?.seven_d;
  const isRateLimited = liveUsage?.status === "rate_limited";

  // Gemini-specific live data
  const geminiToday = liveUsage?.today;
  const geminiModels = liveUsage?.models;
  const quotaBuckets = liveUsage?.quota_api?.buckets;

  // Determine bar color based on utilization
  function barColor(pct: number): "amber" | "red" {
    if (pct >= 90) return "red";
    return "amber";
  }

  return (
    <div className="group px-3 py-3 border-b border-[#1a1a1a]/50 last:border-b-0 transition-colors hover:bg-[#111111]/50 overflow-hidden">
      {/* Header: name, plan badge, delete, check button */}
      <div className="flex items-center gap-2 mb-2.5 min-w-0">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isRateLimited
              ? "bg-red-500 animate-pulse"
              : hasLive
              ? "bg-emerald-500"
              : account.provider === "anthropic"
              ? "bg-amber-400"
              : account.provider === "google"
              ? "bg-blue-400"
              : "bg-emerald-400"
          }`}
        />
        <span className="text-[13px] font-medium text-slate-200 truncate">
          {account.name}
        </span>
        {plan && (
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold uppercase tracking-wide border-0 ${
              account.provider === "anthropic"
                ? "bg-amber-500/15 text-amber-400"
                : account.provider === "google"
                ? "bg-blue-500/15 text-blue-400"
                : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {planLabel(plan)}
          </Badge>
        )}
        <span className="flex-1" />
        {isLiveSupported && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCheckLive}
            disabled={checkingLive}
            className={`h-auto px-1.5 py-0.5 text-[10px] ${
              account.provider === "anthropic"
                ? "text-amber-400/70 hover:text-amber-400"
                : account.provider === "google"
                ? "text-blue-400/70 hover:text-blue-400"
                : "text-emerald-400/70 hover:text-emerald-400"
            }`}
            title={account.provider === "openai"
              ? "Check live usage from OpenAI"
              : account.provider === "google"
              ? "Check live usage from Google"
              : "Check live usage (makes a small API call)"
            }
          >
            {checkingLive ? "..." : "Refresh"}
          </Button>
        )}
      </div>

      <div className="ml-4 flex flex-col gap-2.5">
        {/* ── Utilization bars ──────────────────────────────────── */}
        {hasLive && fiveH?.utilization_pct != null && (
          <UsageBar
            pct={fiveH.utilization_pct}
            label={account.provider === "anthropic" ? "5-hour window" : "Primary window"}
            resetLabel={
              fiveH.resets_in_secs != null && fiveH.resets_in_secs > 0
                ? `resets in ${formatDuration(fiveH.resets_in_secs)}`
                : undefined
            }
            color={barColor(fiveH.utilization_pct)}
            windowTotalSecs={5 * 3600}
            resetsInSecs={fiveH.resets_in_secs ?? undefined}
          />
        )}
        {hasLive && sevenD?.utilization_pct != null && (
          <UsageBar
            pct={sevenD.utilization_pct}
            label={account.provider === "anthropic" ? "7-day window" : "Secondary window"}
            resetLabel={
              sevenD.resets_in_secs != null && sevenD.resets_in_secs > 0
                ? `resets in ${formatDuration(sevenD.resets_in_secs)}`
                : undefined
            }
            color={barColor(sevenD.utilization_pct)}
            windowTotalSecs={7 * 24 * 3600}
            resetsInSecs={sevenD.resets_in_secs ?? undefined}
          />
        )}

        {/* ── Gemini-specific usage display ────────────────────── */}
        {account.provider === "google" && (hasLive || quotaBuckets) && (
          <div className="flex flex-col gap-2">
            {/* Today summary — single compact row */}
            {geminiToday && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Today</span>
                <div className="flex items-center gap-3 text-[11px] tabular-nums">
                  <span className="text-slate-500">
                    {geminiToday.sessions} session{geminiToday.sessions !== 1 ? "s" : ""}
                    {" · "}
                    {geminiToday.messages} msg{geminiToday.messages !== 1 ? "s" : ""}
                  </span>
                  <span className="text-blue-400 font-semibold">
                    {formatTokens(geminiToday.tokens.total)}
                  </span>
                </div>
              </div>
            )}

            {/* Token split — inline row */}
            {geminiToday && (
              <div className="flex items-center gap-2 text-[10px] tabular-nums text-slate-600">
                <span>{formatTokens(geminiToday.tokens.input)} in</span>
                <span className="text-slate-700">·</span>
                <span>{formatTokens(geminiToday.tokens.output)} out</span>
                {geminiToday.tokens.cached > 0 && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="text-emerald-500/60">{formatTokens(geminiToday.tokens.cached)} cached</span>
                  </>
                )}
                {geminiToday.tokens.thoughts > 0 && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="text-purple-400/60">{formatTokens(geminiToday.tokens.thoughts)} thinking</span>
                  </>
                )}
              </div>
            )}

            {/* Per-model quota bars — real usage % from Google API */}
            {quotaBuckets && quotaBuckets.length > 0 && (() => {
              // Collapse to one Pro + one Flash — variants share the same quota
              const proBucket = quotaBuckets.find((b) => b.model_id.includes("pro"));
              const flashBucket = quotaBuckets.find((b) => b.model_id.includes("flash") && !b.model_id.includes("lite"));
              const dedupedBuckets = [
                proBucket ? { ...proBucket, model_id: "Pro" } : null,
                flashBucket ? { ...flashBucket, model_id: "Flash" } : null,
              ].filter(Boolean) as typeof quotaBuckets;
              return (
              <div className="flex flex-col gap-2 mt-0.5">
                {dedupedBuckets.map((b) => {
                  const pct = b.used_pct ?? 0;
                  const atLimit = b.remaining_fraction === 0;
                  const resetLabel = b.reset_time
                    ? (() => {
                        const resetMs = new Date(b.reset_time).getTime() - Date.now();
                        if (resetMs <= 0) return undefined;
                        return `resets in ${formatDuration(Math.round(resetMs / 1000))}`;
                      })()
                    : undefined;
                  return (
                    <UsageBar
                      key={b.model_id}
                      pct={pct}
                      label={b.model_id}
                      resetLabel={atLimit ? "Limit" : resetLabel}
                      color={pct >= 90 ? "red" : "amber"}
                    />
                  );
                })}
              </div>
              );
            })()}

            {/* Fallback: show local model breakdown if no quota API data */}
            {!quotaBuckets && geminiModels && geminiModels.length > 0 && (() => {
              const maxTokens = Math.max(...geminiModels.map((m) => m.tokens.total));
              return (
                <div className="flex flex-col gap-1 mt-0.5">
                  {geminiModels.map((m) => {
                    const pct = maxTokens > 0 ? (m.tokens.total / maxTokens) * 100 : 0;
                    return (
                      <div key={m.model} className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-slate-400 truncate w-28 shrink-0" title={m.model}>
                          {m.model}
                        </span>
                        <div
                          className="flex-1 h-1 overflow-hidden rounded-full"
                          style={{ backgroundColor: "rgba(214, 169, 71, 0.11)" }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(100, pct)}%`,
                              background: "linear-gradient(90deg, #8f6b28 0%, #d6a947 60%, #f2c766 100%)",
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 tabular-nums shrink-0 w-10 text-right">
                          {formatTokens(m.tokens.total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Estimated stats (from local JSONL data) ───────────── */}
        {!isSharedUsage ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-slate-600 tabular-nums">
                {formatTokens(weekTokens)} tokens this week
              </span>
              <span className="text-[10px] text-slate-600 tabular-nums">
                {weekSessions} sessions
              </span>
              {!hasLive && (
                <span className="text-[10px] text-slate-700 italic">local estimates only</span>
              )}
            </div>
            {profileBreakdown.length > 1 && (
              <div className="flex flex-col gap-1 border-l border-[#1a1a1a] pl-2">
                {profileBreakdown.map((profile) => {
                  const profileTokens = profile.week_input_tokens + profile.week_output_tokens;
                  return (
                    <div key={profile.profile} className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-[10px] text-slate-500 truncate" title={profile.profile}>
                        {profile.profile}
                      </span>
                      <span className="text-[10px] text-slate-600 tabular-nums shrink-0">
                        {formatTokens(profileTokens)} · {profile.week_sessions} sessions
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-700 italic">
              local stats shared with other {account.provider === "anthropic" ? "Claude" : "accounts"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Page ────────────────────────────────────────────────────────────────────

// Module-level cache so data persists across tab switches
let _cachedDashboard: {
  stats: IndexStats | null;
  tokenUsage: TokenUsageStats | null;
  accounts: ProviderAccount[];
  usages: Record<string, AccountUsage>;
  liveUsages: Record<string, LiveUsageResult>;
  fetchedAt: number;
} | null = null;

// ─── TokenUsageChart (inline, pure SVG, no deps) ────────────────────────────

function TokenUsageChart({
  daily,
  weekly,
}: {
  daily: { date: string; tokens: number }[];
  weekly: { week_start: string; tokens: number }[];
}) {
  const [mode, setMode] = useState<"daily" | "weekly">("daily");
  const [hover, setHover] = useState<number | null>(null);
  const data = mode === "daily" ? daily : weekly;
  const max = Math.max(1, ...data.map((d) => d.tokens));
  const total = data.reduce((acc, d) => acc + d.tokens, 0);
  const n = data.length;
  const hovered = hover != null ? data[hover] : null;

  // ViewBox in nice round units — scales responsively.
  const W = 600;
  const H = 160;
  const padX = 4;
  const padBottom = 22;
  const padTop = 4;
  const barW = n > 0 ? (W - padX * 2) / n : 0;
  const chartH = H - padTop - padBottom;

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const labelFor = (d: { date?: string; week_start?: string }): string => {
    const iso = d.date ?? d.week_start ?? "";
    if (!iso) return "";
    const [, mm, dd] = iso.split("-");
    const mIdx = parseInt(mm, 10) - 1;
    const day = parseInt(dd, 10);
    return `${MONTHS[mIdx] ?? mm} ${day}`;
  };

  // Daily: label only on Mondays + first/last bar to avoid clutter.
  // Weekly: label every other bar, plus the most recent.
  const shouldLabel = (i: number, iso: string): boolean => {
    if (i === n - 1 || i === 0) return true;
    if (mode === "weekly") return i % 2 === 0;
    // daily: Monday or 1st of month
    const dt = new Date(`${iso}T00:00:00`);
    return dt.getDay() === 1 || dt.getDate() === 1;
  };

  const gridlines = [0.25, 0.5, 0.75, 1].map((f) => padTop + chartH * (1 - f));
  const barFill = (ratio: number, isHover: boolean) => {
    if (isHover) return "#f2c766";
    if (ratio >= 0.82) return "#ff725f";
    if (ratio >= 0.58) return "#d6a947";
    if (ratio >= 0.32) return "#31c6b7";
    return "#427489";
  };
  const barOpacity = (ratio: number, isHover: boolean) => {
    if (isHover) return 1;
    return 0.52 + Math.min(0.38, ratio * 0.38);
  };

  return (
    <Card className="rounded-none border-0 bg-transparent p-4 shadow-none">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] text-slate-500">Token usage</div>
          <div className="text-xs text-slate-400 tabular-nums">
            {hovered
              ? `${labelFor(hovered)} · ${formatTokens(hovered.tokens)}`
              : `${mode === "daily" ? "Last 30 days" : "Last 12 weeks"} · peak ${formatTokens(max)} · total ${formatTokens(total)}`}
          </div>
        </div>
        <div className="inline-flex rounded-md border border-[#1a1a1a] bg-[#0b0d12] p-0.5">
          {(["daily", "weekly"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setHover(null);
              }}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-sm transition-colors ${
                mode === m
                  ? "bg-cyan-500/10 text-cyan-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {m === "daily" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-40"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
      >
        {gridlines.map((y, i) => (
          <line
            key={i}
            x1={padX}
            x2={W - padX}
            y1={y}
            y2={y}
            stroke="#1a1a1a"
            strokeWidth={0.5}
          />
        ))}
        {data.map((d, i) => {
          const h = (d.tokens / max) * chartH;
          const ratio = d.tokens / max;
          const x = padX + i * barW + barW * 0.15;
          const y = padTop + chartH - h;
          const w = barW * 0.7;
          const isHover = hover === i;
          return (
            <g key={i}>
              {/* Full-height hit target so mouse doesn't need to land on a short bar. */}
              <rect
                x={padX + i * barW}
                y={padTop}
                width={barW}
                height={chartH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(h, d.tokens > 0 ? 1 : 0)}
                fill={barFill(ratio, isHover)}
                opacity={barOpacity(ratio, isHover)}
                pointerEvents="none"
              />
            </g>
          );
        })}
        {/* Hover guideline */}
        {hover != null && (
          <line
            x1={padX + hover * barW + barW / 2}
            x2={padX + hover * barW + barW / 2}
            y1={padTop}
            y2={padTop + chartH}
            stroke="#f2c766"
            strokeWidth={0.5}
            strokeDasharray="2 2"
            opacity={0.5}
            pointerEvents="none"
          />
        )}
        {/* Tick marks */}
        {data.map((_, i) => {
          if (i % (mode === "daily" ? 5 : 1) !== 0 && i !== n - 1) return null;
          const x = padX + i * barW + barW / 2;
          return (
            <line
              key={`tick-${i}`}
              x1={x}
              x2={x}
              y1={padTop + chartH}
              y2={padTop + chartH + 3}
              stroke="#334155"
              strokeWidth={0.5}
            />
          );
        })}
        {/* X-axis labels */}
        {data.map((d, i) => {
          const iso = (d as { date?: string; week_start?: string }).date
            ?? (d as { date?: string; week_start?: string }).week_start
            ?? "";
          if (!shouldLabel(i, iso)) return null;
          const x = padX + i * barW + barW / 2;
          const isHover = hover === i;
          const isLast = i === n - 1;
          return (
            <text
              key={`t-${i}`}
              x={x}
              y={H - 6}
              textAnchor="middle"
              fontSize={9}
              fontWeight={isHover || isLast ? 600 : 400}
              fill={isHover ? "#f2c766" : isLast ? "#cbd5e1" : "#64748b"}
            >
              {labelFor(d)}
            </text>
          );
        })}
      </svg>
    </Card>
  );
}

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export default function Home() {
  const isInitialLoad = useRef(true);

  // Data state — initialize from cache if available
  const [stats, setStats] = useState<IndexStats | null>(_cachedDashboard?.stats ?? null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageStats | null>(_cachedDashboard?.tokenUsage ?? null);
  const [accounts, setAccounts] = useState<ProviderAccount[]>(_cachedDashboard?.accounts ?? []);
  const [accountUsages, setAccountUsages] = useState<Record<string, AccountUsage>>(_cachedDashboard?.usages ?? {});
  const [liveUsages, setLiveUsages] = useState<Record<string, LiveUsageResult>>(_cachedDashboard?.liveUsages ?? {});
  const [checkingLiveFor, setCheckingLiveFor] = useState<string | null>(null);

  // UI state — skip loading spinner if we have cached data
  const [loading, setLoading] = useState(_cachedDashboard === null);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<TriggerIndexResult | null>(
    null
  );

  // ─── Load all dashboard data ────────────────────────────────────────────

  const loadDashboard = useCallback(async (showSpinner: boolean = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    try {
      // Kick off account usage in parallel with the rest of the dashboard.
      // Uses cached account IDs so usage queries don't wait for the
      // listProviderAccounts roundtrip. Any new accounts discovered below
      // get their usage fetched in a small second wave.
      const cachedAccounts = _cachedDashboard?.accounts ?? [];
      const cachedUsagePromise = Promise.allSettled(
        cachedAccounts.map(async (a) => [a.id, await checkAccountUsage(a.id)] as const)
      );

      const [
        statsResult,
        tokenUsageResult,
        accountsResult,
        cachedUsagesResult,
      ] = await Promise.all([
        getIndexStats().then(
          (v) => ({ status: "fulfilled" as const, value: v }),
          (e) => ({ status: "rejected" as const, reason: e })
        ),
        getTokenUsageStats().then(
          (v) => ({ status: "fulfilled" as const, value: v }),
          (e) => ({ status: "rejected" as const, reason: e })
        ),
        detectProviderAccounts()
          .then((v) => v.accounts)
          .catch(() => listProviderAccounts())
          .then(
            (v) => ({ status: "fulfilled" as const, value: v }),
            (e) => ({ status: "rejected" as const, reason: e })
          ),
        cachedUsagePromise,
      ]);

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      }
      if (tokenUsageResult.status === "fulfilled") {
        setTokenUsage(tokenUsageResult.value);
      }

      // Seed usage map with cached-ID results that came back alongside the rest.
      const usageMap: Record<string, AccountUsage> = {};
      cachedUsagesResult.forEach((r) => {
        if (r.status === "fulfilled") {
          const [id, usage] = r.value;
          usageMap[id] = usage;
        }
      });

      if (accountsResult.status === "fulfilled") {
        const accts = accountsResult.value;

        setAccounts(accts);

        // Fetch usage only for accounts that weren't covered by the cached
        // parallel fetch (new accounts since last load, or first-ever load).
        const cachedIds = new Set(cachedAccounts.map((a) => a.id));
        const missing = accts.filter((a) => !cachedIds.has(a.id));
        if (missing.length > 0) {
          const extraResults = await Promise.allSettled(
            missing.map((a) => checkAccountUsage(a.id))
          );
          extraResults.forEach((r, i) => {
            if (r.status === "fulfilled") {
              usageMap[missing[i].id] = r.value;
            }
          });
        }
        setAccountUsages(usageMap);
      } else if (Object.keys(usageMap).length > 0) {
        setAccountUsages(usageMap);
      }

      // If critical reads failed, surface the first error
      if (statsResult.status === "rejected") {
        const msg =
          statsResult.reason instanceof Error
            ? statsResult.reason.message
            : String(statsResult.reason);
        if (msg === "TAURI_NOT_AVAILABLE") {
          setError(
            "Tauri APIs not available. Run inside the desktop app to see live data."
          );
        } else {
          setError(msg);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      isInitialLoad.current = false;
    }
  }, []);

  // Write state to module-level cache whenever data changes
  useEffect(() => {
    if (loading) return;
    _cachedDashboard = {
      stats,
      tokenUsage,
      accounts,
      usages: accountUsages,
      liveUsages,
      fetchedAt: Date.now(),
    };
  }, [loading, stats, tokenUsage, accounts, accountUsages, liveUsages]);

  // Refresh without showing loading spinners (for background event updates)
  const refreshDashboard = useCallback(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  // Initial load — skip if cache is fresh (< 3 min old)
  useEffect(() => {
    if (_cachedDashboard && Date.now() - _cachedDashboard.fetchedAt < CACHE_TTL_MS) {
      // Cache is fresh, no fetch needed
      return;
    }
    loadDashboard();
  }, [loadDashboard]);

  // ─── Periodic background sync every 60s ───────────────────────────────
  // Tight loop keeps token-usage counters near-realtime. Backend indexer
  // also runs every 60s so fresh JSONL bytes land in the DB before we read.

  useEffect(() => {
    if (!isTauriAvailable()) return;

    const interval = setInterval(() => {
      refreshDashboard();
    }, 60_000);

    return () => clearInterval(interval);
  }, [refreshDashboard]);

  // ─── Auto-refresh live usage every 60s ─────────────────────────────────

  const refreshLiveUsage = useCallback(async (accts: ProviderAccount[]) => {
    const supported = accts.filter((a) =>
      ["anthropic", "openai", "google"].includes(a.provider)
    );
    if (supported.length === 0) return;

    const results = await Promise.allSettled(
      supported.map((a) => checkLiveUsage(a.provider, a.api_key ?? undefined))
    );
    setLiveUsages((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          next[supported[i].id] = r.value;
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    // Don't start until accounts are loaded
    if (accounts.length === 0) return;

    // Fetch immediately on first load
    refreshLiveUsage(accounts);

    // Then every 60 seconds
    const interval = setInterval(() => {
      refreshLiveUsage(accounts);
    }, 60_000);

    return () => clearInterval(interval);
  }, [accounts, refreshLiveUsage]);

  // Tray title + menu are managed globally by `useTrayMonitor` in App so they
  // stay current regardless of which page is mounted.

  // ─── Trigger re-index ──────────────────────────────────────────────────

  const handleTriggerIndex = useCallback(async () => {
    setIndexing(true);
    setIndexResult(null);
    try {
      const result = await triggerIndex();
      setIndexResult(result);
      // Refresh dashboard after indexing (no spinners — user sees "Indexing..." state)
      await refreshDashboard();
    } catch (err) {
      console.error("Trigger index failed:", err);
    } finally {
      setIndexing(false);
    }
  }, [refreshDashboard]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full overflow-y-auto overflow-x-hidden px-5 pb-8 pt-20">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerIndex}
            disabled={indexing}
            className="h-10 shrink-0 justify-center gap-2 border-white/70 bg-white px-5 text-black shadow-[0_0_0_1px_rgba(125,211,252,0.08),0_18px_40px_-30px_rgba(125,211,252,0.85)] transition-all duration-150 hover:border-[var(--cv-accent)] hover:bg-[var(--cv-accent)] hover:text-[#031016] hover:shadow-[0_0_0_1px_rgba(125,211,252,0.32),0_0_28px_rgba(125,211,252,0.24)] focus-visible:ring-1 focus-visible:ring-[var(--cv-accent)] active:translate-y-px disabled:border-white/20 disabled:bg-white/45 disabled:text-black/55 disabled:shadow-none"
          >
            <RefreshCw size={15} className={indexing ? "animate-spin" : ""} />
            {indexing ? "Indexing..." : "Re-index local data"}
          </Button>
        </div>

      {/* Index result banner */}
      {indexResult && (
        <div className="cv-panel flex items-center gap-3 px-4 py-3">
          <span className="text-emerald-400 text-sm">{"\u2714"}</span>
          <p className="text-xs text-emerald-300">
            Indexed {indexResult.indexed_sessions} sessions and{" "}
            {indexResult.indexed_messages} messages across{" "}
            {indexResult.projects_scanned} projects.
          </p>
          <button
            onClick={() => setIndexResult(null)}
            className="ml-auto text-xs text-emerald-400/50 hover:text-emerald-400"
          >
            {"\u2715"}
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="cv-panel flex items-center gap-3 border-red-500/25 bg-red-500/5 px-4 py-3">
          <span className="text-red-400 text-sm">{"\u26A0"}</span>
          <p className="text-xs text-red-300">{error}</p>
          <button
            onClick={() => loadDashboard()}
            className="ml-auto text-xs text-red-400/50 hover:text-red-400"
          >
            Retry
          </button>
        </div>
      )}

      {/* Token period cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Today", value: tokenUsage?.today ?? 0, color: "text-cyan-400" },
          { label: "This week", value: tokenUsage?.this_week ?? 0, color: "text-emerald-400" },
          { label: "This month", value: tokenUsage?.this_month ?? 0, color: "text-yellow-400" },
          { label: "This year", value: tokenUsage?.this_year ?? 0, color: "text-rose-400" },
        ].map((stat) => (
          <Card
            key={stat.label}
            className="cv-frame flex items-center justify-between overflow-hidden rounded-none px-4 py-4"
          >
            <span className="cv-label mr-2 truncate">{stat.label}</span>
            <span className={`text-sm font-semibold tabular-nums shrink-0 ${stat.color}`}>
              {loading && !tokenUsage ? "--" : formatTokens(stat.value)}
            </span>
          </Card>
        ))}
      </div>

      {/* Token usage chart */}
      {tokenUsage && (
        <div className="cv-frame overflow-hidden">
          <div className="cv-terminal-bar h-10 px-4">
            <BarChart3 size={14} className="text-[var(--cv-accent)]" />
            <span className="cv-label">token burn rate</span>
          </div>
          <TokenUsageChart
            daily={tokenUsage.daily_series}
            weekly={tokenUsage.weekly_series}
          />
        </div>
      )}

      {/* Usage — remaining per account */}
      <div className="cv-frame overflow-hidden">
        <div className="cv-terminal-bar h-10 px-4">
          <Activity size={14} className="text-[var(--cv-accent)]" />
          <span className="cv-label">provider telemetry</span>
          <div className="ml-auto flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-300"
              onClick={async () => {
                try {
                  // Re-detect accounts AND re-index sessions
                  const [result] = await Promise.all([
                    detectProviderAccounts(),
                    triggerIndex(),
                  ]);
                  setAccounts(result.accounts);
                  if (result.accounts.length > 0) {
                    const usageResults = await Promise.allSettled(
                      result.accounts.map((a) => checkAccountUsage(a.id))
                    );
                    const usageMap: Record<string, AccountUsage> = {};
                    usageResults.forEach((r, i) => {
                      if (r.status === "fulfilled") {
                        usageMap[result.accounts[i].id] = r.value;
                      }
                    });
                    setAccountUsages(usageMap);
                  }
                  // Refresh dashboard data after index
                  refreshDashboard();
                } catch (err) {
                  console.error("Detection failed:", err);
                }
              }}
            >
              Re-detect
            </Button>
          </div>
        </div>
        {loading ? (
          <Card className="flex items-center justify-center rounded-none border-0 bg-transparent py-8">
            <svg className="h-4 w-4 animate-spin text-slate-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </Card>
        ) : (
          <Card className="overflow-hidden rounded-none border-0 bg-transparent">
            {accounts.length === 0 ? (
              <CardContent className="flex flex-col items-center justify-center py-5 p-5">
                <Terminal className="mb-2 h-6 w-6 text-slate-600" />
                <p className="text-[11px] text-slate-500">No CLI accounts detected</p>
                <p className="text-[11px] text-slate-600 mt-0.5">Log into Claude Code, Codex, Cursor, or Gemini to auto-detect</p>
              </CardContent>
            ) : (
              accounts.map((account, idx) => {
                // If multiple accounts share the same provider, only the first shows local stats
                const isFirstOfProvider = accounts.findIndex((a) => a.provider === account.provider) === idx;
                const hasSiblings = accounts.filter((a) => a.provider === account.provider).length > 1;
                return (
                <AccountUsageRow
                  key={account.id}
                  account={account}
                  usage={accountUsages[account.id] ?? null}
                  liveUsage={liveUsages[account.id] ?? null}
                  checkingLive={checkingLiveFor === account.id}
                  isSharedUsage={hasSiblings && !isFirstOfProvider}
                  onCheckLive={async () => {
                    setCheckingLiveFor(account.id);
                    try {
                      const result = await checkLiveUsage(account.provider, account.api_key ?? undefined);
                      setLiveUsages((prev) => ({ ...prev, [account.id]: result }));
                    } catch (err) {
                      console.error("Live usage check failed:", err);
                    } finally {
                      setCheckingLiveFor(null);
                    }
                  }}
                  onDelete={async () => {
                    try {
                      await deleteProviderAccount(account.id);
                      refreshDashboard();
                    } catch (err) {
                      console.error("Failed to delete account:", err);
                    }
                  }}
                />
              );})

            )}
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}
