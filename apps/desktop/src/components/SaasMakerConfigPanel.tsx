import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCurrentUser,
  getSaasMakerStatus,
  isTauriAvailable,
  listSaasMakerProjects,
  pollSaasMakerSignin,
  type SaasMakerProject,
  type SaasMakerStatus,
  type SaasMakerUser,
  setSaasMakerConfig,
  signOutOfSaasMaker,
  startSaasMakerSignin,
} from "@/lib/tauri-ipc";

type SignInPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "polling"; code: string; approvalUrl: string }
  | { kind: "expired" }
  | { kind: "approved" };

export default function SaasMakerConfigPanel() {
  const [status, setStatus] = useState<SaasMakerStatus | null>(null);
  const [user, setUser] = useState<SaasMakerUser | null>(null);
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [projects, setProjects] = useState<SaasMakerProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignInPhase>({ kind: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const cancelledRef = useRef(false);

  const loadProjects = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setProjectsLoading(true);
    try {
      const rows = await listSaasMakerProjects();
      setProjects(rows);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch {
      // Silent — if /v1/auth/session fails we just don't show the badge.
      setUser(null);
    }
  }, []);

  const load = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const s = await getSaasMakerStatus();
      setStatus(s);
      setBaseUrl(s.base_url);
      setProjectSlug(s.project_slug ?? "");
      if (s.configured) {
        await Promise.all([loadProjects(), refreshUser()]);
      } else {
        setUser(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadProjects, refreshUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Configuration requires the desktop app.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const s = await setSaasMakerConfig({
        token: token || null,
        base_url: baseUrl || null,
        project_slug: projectSlug || null,
      });
      setStatus(s);
      setToken("");
      if (s.configured) {
        await refreshUser();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [token, baseUrl, projectSlug, refreshUser]);

  const handleSignIn = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Sign in requires the desktop app.");
      return;
    }
    setError(null);
    cancelledRef.current = false;
    setSignIn({ kind: "starting" });
    try {
      const start = await startSaasMakerSignin();
      setSignIn({
        kind: "polling",
        code: start.code,
        approvalUrl: start.approval_url,
      });
      const result = await pollSaasMakerSignin(start.code);
      if (cancelledRef.current) {
        setSignIn({ kind: "idle" });
        return;
      }
      if (result.status === "approved") {
        setUser(result.user);
        setSignIn({ kind: "approved" });
        await load();
        // Brief celebratory state, then back to idle.
        setTimeout(() => setSignIn({ kind: "idle" }), 1500);
      } else if (result.status === "expired") {
        setSignIn({ kind: "expired" });
      } else {
        setSignIn({ kind: "idle" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSignIn({ kind: "idle" });
    }
  }, [load]);

  const handleCancelSignIn = useCallback(() => {
    cancelledRef.current = true;
    setSignIn({ kind: "idle" });
  }, []);

  const handleSignOut = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      await signOutOfSaasMaker();
      setUser(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  const tokenFromEnv = status?.token_source === "env";
  const polling = signIn.kind === "polling" || signIn.kind === "starting";

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Connect to the fleet task DB at{" "}
        <span className="font-mono">api.sassmaker.com</span>. CodeVetter and the
        cockpit read/write the same projects and tasks.
      </p>

      {/* IDENTITY BLOCK — the headline */}
      {user ? (
        <IdentityBlock
          user={user}
          tokenSource={status?.token_source ?? "preferences"}
          onSignOut={handleSignOut}
        />
      ) : signIn.kind === "approved" ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
          <CheckCircle2 size={14} className="mr-1.5 inline" />
          Signed in successfully.
        </div>
      ) : (
        <SignInBlock
          phase={signIn}
          onSignIn={handleSignIn}
          onCancel={handleCancelSignIn}
          tokenFromEnv={tokenFromEnv}
        />
      )}

      {/* PROJECT SLUG (visible whenever connected, since this is the most
          actionable knob) */}
      {status?.configured && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="cv-label">Project slug</label>
            <button
              type="button"
              onClick={loadProjects}
              disabled={projectsLoading}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-[var(--cv-accent)] disabled:opacity-40"
            >
              {projectsLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RefreshCw size={10} />
              )}
              fetch from fleet
            </button>
          </div>
          {projects.length > 0 ? (
            <select
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="w-full rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1.5 font-mono text-xs text-slate-200"
            >
              <option value="">(none)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.slug ?? ""}>
                  {p.name}
                  {p.slug ? ` — ${p.slug}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={projectSlug}
              placeholder="codevetter"
              onChange={(e) => setProjectSlug(e.target.value)}
              className="font-mono text-xs"
            />
          )}
          <p className="mt-1 text-[10px] text-slate-500">
            Default project slug used when pulling tasks and pushing findings.
            Once you mark a fleet project&apos;s git URL, the auto-detect picks
            this up per-repo automatically.
          </p>
        </div>
      )}

      {/* ADVANCED — collapsed by default */}
      <div className="border-t border-[var(--cv-line)] pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] text-slate-500 hover:text-[var(--cv-accent)]"
        >
          {showAdvanced ? "▼" : "▶"} Advanced (manual token, custom base URL)
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="cv-label mb-1 block">Session token</label>
              <Input
                type="password"
                value={token}
                placeholder={
                  tokenFromEnv
                    ? "Overridden by SAASMAKER_SESSION_TOKEN env"
                    : status?.configured
                      ? "(stored — replace to update)"
                      : "Bearer token from SaaS Maker"
                }
                onChange={(e) => setToken(e.target.value)}
                disabled={tokenFromEnv}
                className="font-mono text-xs"
              />
              {tokenFromEnv && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Env var wins over stored values. Unset it to edit here.
                </p>
              )}
            </div>

            <div>
              <label className="cv-label mb-1 block">Base URL</label>
              <Input
                value={baseUrl}
                placeholder="https://api.sassmaker.com"
                onChange={(e) => setBaseUrl(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving || polling}
              >
                {saving ? (
                  <>
                    <Loader2 size={12} className="mr-1.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save size={12} className="mr-1.5" />
                    Save advanced
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="font-mono">{error}</span>
        </div>
      )}
    </div>
  );
}

function IdentityBlock({
  user,
  tokenSource,
  onSignOut,
}: {
  user: SaasMakerUser;
  tokenSource: string;
  onSignOut: () => void;
}) {
  const initials = (user.name ?? user.email ?? "U")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt=""
          className="h-10 w-10 rounded-full border border-emerald-500/30 object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 font-mono text-sm text-emerald-200">
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-100">
            {user.name ?? "Signed in"}
          </span>
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-200"
          >
            <CheckCircle2 size={9} className="mr-1 inline" />
            connected · {tokenSource}
          </Badge>
        </div>
        {user.email && (
          <div className="truncate font-mono text-[10px] text-slate-500">
            {user.email}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSignOut}
        className="h-8 shrink-0"
      >
        <LogOut size={12} className="mr-1.5" />
        Sign out
      </Button>
    </div>
  );
}

function SignInBlock({
  phase,
  onSignIn,
  onCancel,
  tokenFromEnv,
}: {
  phase: SignInPhase;
  onSignIn: () => void;
  onCancel: () => void;
  tokenFromEnv: boolean;
}) {
  if (phase.kind === "polling") {
    return (
      <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-3 py-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-[var(--cv-accent)]" />
          <span className="text-sm font-medium text-slate-100">
            Waiting for approval in your browser…
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          A tab opened to your cockpit. Click <strong>Approve CodeVetter</strong>{" "}
          and this dialog will sign you in automatically.
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <a
            href={phase.approvalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--cv-accent)] hover:underline"
          >
            <ExternalLink size={10} />
            re-open approval page
          </a>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="h-7"
          >
            <X size={12} className="mr-1" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "expired") {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3">
        <div className="flex items-center gap-2 text-sm text-amber-200">
          <AlertTriangle size={14} />
          That sign-in window expired.
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Auth codes are valid for 10 minutes and the poll caps at 5. Try again.
        </p>
        <Button type="button" size="sm" onClick={onSignIn} className="mt-2">
          <LogIn size={12} className="mr-1.5" />
          Sign in with SaaS Maker
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-slate-100">
            Not signed in
          </div>
          <p className="text-[11px] text-slate-400">
            Sign in once. Your fleet projects and tasks become available across
            CodeVetter.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onSignIn}
          disabled={phase.kind === "starting" || tokenFromEnv}
        >
          {phase.kind === "starting" ? (
            <>
              <Loader2 size={12} className="mr-1.5 animate-spin" />
              Opening…
            </>
          ) : (
            <>
              <LogIn size={12} className="mr-1.5" />
              Sign in with SaaS Maker
            </>
          )}
        </Button>
      </div>
      {tokenFromEnv && (
        <p className="mt-1 text-[10px] text-slate-500">
          SAASMAKER_SESSION_TOKEN is set in your shell — that already
          authenticates you.
        </p>
      )}
    </div>
  );
}
