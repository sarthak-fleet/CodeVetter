import { useEffect, useRef } from "react";

import {
  checkLiveUsage,
  getPreference,
  getTokenUsageStats,
  isTauriAvailable,
  listProviderAccounts,
  type LiveUsageResult,
  type ProviderAccount,
  sendTrayNotification,
  setTrayMenu,
  setTrayText,
} from "@/lib/tauri-ipc";

// Default cadence matches CodexBar's typical 2-minute poll. Quota windows
// don't move fast enough to need anything tighter, and Anthropic's rate-limit
// headers cost a live API request per check.
const DEFAULT_CADENCE_SECS = 120;

const SUPPORTED_PROVIDERS = new Set(["anthropic", "openai", "google"]);

// Thresholds (worst-window utilization %) that should fire a desktop
// notification. Each (accountId × window × threshold) only fires once per app
// process — the ref below holds the latest threshold we've already notified.
const NOTIFY_THRESHOLDS = [75, 90, 100];

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatDuration(secs: number): string {
  if (secs <= 0) return "now";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Worst utilization pct across both rate-limit windows + Gemini quota buckets. */
function worstUtilPct(live: LiveUsageResult | undefined): number {
  if (!live) return 0;
  let worst = 0;
  if ((live.five_h?.utilization_pct ?? 0) > worst) {
    worst = live.five_h?.utilization_pct ?? 0;
  }
  if ((live.seven_d?.utilization_pct ?? 0) > worst) {
    worst = live.seven_d?.utilization_pct ?? 0;
  }
  for (const b of live.quota_api?.buckets ?? []) {
    if ((b.used_pct ?? 0) > worst) worst = b.used_pct ?? 0;
  }
  return worst;
}

function buildTrayLine(
  account: ProviderAccount,
  live: LiveUsageResult | undefined
): string {
  const label = account.name || account.provider;
  const plan = account.plan ? ` (${account.plan})` : "";
  if (!live) return `${label}${plan} — …`;

  if (account.provider === "anthropic" || account.provider === "openai") {
    if (account.provider === "openai" && !live.supported) {
      return `${label}${plan} — ${live.reason ?? "n/a"}`;
    }
    const parts: string[] = [];
    const fh = live.five_h?.utilization_pct;
    const sd = live.seven_d?.utilization_pct;
    if (fh != null) parts.push(`5h ${Math.round(fh)}%`);
    if (sd != null) parts.push(`7d ${Math.round(sd)}%`);
    const resetSecs = [
      live.five_h?.resets_in_secs,
      live.seven_d?.resets_in_secs,
    ].filter((s): s is number => typeof s === "number" && s > 0);
    if (resetSecs.length) {
      parts.push(`resets ${formatDuration(Math.min(...resetSecs))}`);
    }
    if (!parts.length) parts.push(live.status ?? "ok");
    return `${label}${plan} — ${parts.join(" · ")}`;
  }

  if (account.provider === "google") {
    const parts: string[] = [];
    const t = live.today?.tokens?.total;
    if (t != null) parts.push(`${formatTokens(t)} today`);
    const buckets = live.quota_api?.buckets ?? [];
    if (buckets.length) {
      const worst = buckets.reduce<typeof buckets[number] | null>(
        (acc, b) => ((b.used_pct ?? 0) > (acc?.used_pct ?? -1) ? b : acc),
        null
      );
      if (worst && worst.used_pct != null) {
        parts.push(`${Math.round(worst.used_pct)}% quota`);
      }
      if (worst?.reset_time) {
        const ms = new Date(worst.reset_time).getTime() - Date.now();
        if (ms > 0) parts.push(`resets ${formatDuration(Math.floor(ms / 1000))}`);
      }
    }
    return parts.length
      ? `${label}${plan} — ${parts.join(" · ")}`
      : `${label}${plan} — no data`;
  }

  return `${label}${plan} — ${live.status ?? "ok"}`;
}

async function loadCadenceSecs(): Promise<number> {
  if (!isTauriAvailable()) return DEFAULT_CADENCE_SECS;
  try {
    const raw = await getPreference("tray_refresh_cadence_secs");
    if (raw == null) return DEFAULT_CADENCE_SECS;
    if (raw === "manual") return 0; // 0 → no auto-refresh
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CADENCE_SECS;
  } catch {
    return DEFAULT_CADENCE_SECS;
  }
}

async function loadNotificationsEnabled(): Promise<boolean> {
  if (!isTauriAvailable()) return true;
  try {
    const raw = await getPreference("notify_quota_thresholds");
    return raw !== "false";
  } catch {
    return true;
  }
}

/**
 * Mounts a single global tray monitor at App level so the menu-bar icon stays
 * fresh regardless of which page the user is on. Polls accounts + live usage
 * on the user-configured cadence and fires quota threshold notifications.
 */
export function useTrayMonitor(): void {
  // Persist last-notified threshold per accountId across re-renders so we
  // don't re-fire the same notification on every poll.
  const lastNotifiedRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!isTauriAvailable()) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      try {
        const accounts = await listProviderAccounts().catch(
          () => [] as ProviderAccount[]
        );
        const supported = accounts.filter((a) =>
          SUPPORTED_PROVIDERS.has(a.provider)
        );

        // Live usage for each supported provider in parallel.
        const liveResults = await Promise.allSettled(
          supported.map((a) =>
            checkLiveUsage(a.provider, a.api_key ?? undefined)
          )
        );
        const liveMap: Record<string, LiveUsageResult> = {};
        liveResults.forEach((r, i) => {
          if (r.status === "fulfilled") liveMap[supported[i].id] = r.value;
        });

        // Today's tokens (separate query; cheap local SQLite call).
        const tokenUsage = await getTokenUsageStats().catch(() => null);

        // ── Title: worst pct · today ────────────────────────────────────
        let worstPct = 0;
        for (const a of accounts) worstPct = Math.max(worstPct, worstUtilPct(liveMap[a.id]));
        const today = tokenUsage ? formatTokens(tokenUsage.today) : "";
        const title = worstPct > 0
          ? today
            ? `${Math.round(worstPct)}% · ${today}`
            : `${Math.round(worstPct)}%`
          : today;
        if (title) await setTrayText(title).catch(() => {});

        // ── Menu lines ─────────────────────────────────────────────────
        if (accounts.length > 0) {
          const lines = accounts.map((a) => buildTrayLine(a, liveMap[a.id]));
          await setTrayMenu(lines).catch(() => {});
        }

        // ── Quota threshold notifications ──────────────────────────────
        const notifyEnabled = await loadNotificationsEnabled();
        if (notifyEnabled) {
          for (const a of accounts) {
            const pct = worstUtilPct(liveMap[a.id]);
            const crossed = NOTIFY_THRESHOLDS.filter((t) => pct >= t).pop();
            if (!crossed) continue;
            const last = lastNotifiedRef.current[a.id] ?? 0;
            if (crossed <= last) continue;
            lastNotifiedRef.current[a.id] = crossed;
            const label = a.name || a.provider;
            const verb = crossed >= 100 ? "rate-limited" : `at ${crossed}%`;
            await sendTrayNotification(
              `${label} ${verb}`,
              `Worst window utilization: ${Math.round(pct)}%`
            ).catch(() => {});
          }
        }
      } catch {
        // Swallow — never let a failed poll break the loop.
      }

      // Reschedule based on the (possibly updated) cadence preference.
      const cadenceSecs = await loadCadenceSecs();
      if (cadenceSecs > 0 && !cancelled) {
        timerId = setTimeout(tick, cadenceSecs * 1000);
      }
    }

    void tick();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);
}
