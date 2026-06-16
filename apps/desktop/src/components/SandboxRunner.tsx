import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader2,
  PlayCircle,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isTauriAvailable,
  listenToSandboxSteps,
  runBranchSandbox,
  type SandboxRunResult,
  type SandboxStep,
  type SandboxVerdict,
} from "@/lib/tauri-ipc";

interface Props {
  repoPath: string;
  branch: string;
  baseBranch?: string | null;
  reviewId?: string | null;
  /** Called when the sandbox finishes successfully so the parent can refetch findings. */
  onComplete?: (result: SandboxRunResult) => void;
}

interface PhaseEvent {
  phase: string;
  detail: string | null;
  ts: number;
}

const PHASE_LABELS: Record<string, string> = {
  setup: "Setting up worktree",
  install: "Installing dependencies",
  dev_server: "Starting dev server",
  browser: "Driving browser",
  tests: "Running project tests",
  synthesize: "Synthesizing verdict",
  done: "Done",
};

const VERDICT_LOOK: Record<
  SandboxVerdict,
  { label: string; icon: typeof CheckCircle2; color: string; bg: string; border: string }
> = {
  APPROVE: {
    label: "APPROVE",
    icon: CheckCircle2,
    color: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
  },
  NEEDS_REVIEW: {
    label: "NEEDS REVIEW",
    icon: AlertTriangle,
    color: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/40",
  },
  BLOCK: {
    label: "BLOCK",
    icon: XCircle,
    color: "text-red-300",
    bg: "bg-red-500/10",
    border: "border-red-500/40",
  },
};

export default function SandboxRunner({
  repoPath,
  branch,
  baseBranch,
  reviewId,
  onComplete,
}: Props) {
  const [running, setRunning] = useState(false);
  const [phases, setPhases] = useState<PhaseEvent[]>([]);
  const [steps, setSteps] = useState<SandboxStep[]>([]);
  const [result, setResult] = useState<SandboxRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState({
    run_dev_server: true,
    drive_browser: true,
    run_tests: true,
  });
  const [startPath, setStartPath] = useState<string>("");
  const [showSteps, setShowSteps] = useState(false);
  const [showTestOutput, setShowTestOutput] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Cleanup any listener if we unmount mid-run.
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const canRun = useMemo(
    () => Boolean(repoPath && branch) && !running,
    [repoPath, branch, running],
  );

  const handleRun = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Sandbox requires the desktop app.");
      return;
    }
    if (!repoPath || !branch) {
      setError("Need a repo path and a selected branch.");
      return;
    }
    setError(null);
    setResult(null);
    setPhases([]);
    setSteps([]);
    setRunning(true);

    const unlisten = await listenToSandboxSteps((step) => {
      setSteps((prev) => [...prev, step]);
      if (step.kind === "phase") {
        setPhases((prev) => [
          ...prev,
          { phase: step.phase, detail: step.detail, ts: Date.now() },
        ]);
      }
    });
    unlistenRef.current = unlisten;

    try {
      const r = await runBranchSandbox({
        repo_path: repoPath,
        branch,
        base_branch: baseBranch ?? null,
        review_id: reviewId ?? null,
        options: {
          run_dev_server: opts.run_dev_server,
          drive_browser: opts.drive_browser,
          run_tests: opts.run_tests,
          start_path: startPath || null,
        },
      });
      setResult(r);
      onComplete?.(r);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunning(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [repoPath, branch, baseBranch, reviewId, opts, startPath, onComplete]);

  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlayCircle size={14} className="text-[var(--cv-accent)]" />
          <span className="cv-label">T-Rex sandbox</span>
          <Badge
            variant="outline"
            className="border-cyan-500/40 bg-cyan-500/10 text-[9px] uppercase tracking-wider text-[var(--cv-accent)]"
          >
            Beta
          </Badge>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleRun}
          disabled={!canRun}
          className="h-7"
        >
          {running ? (
            <>
              <Loader2 size={12} className="mr-1.5 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <PlayCircle size={12} className="mr-1.5" />
              Test branch
            </>
          )}
        </Button>
      </div>

      <p className="mb-3 text-[10px] text-[var(--text-secondary)]">
        Checks out <span className="font-mono">{branch || "—"}</span> in a
        worktree, spins up the dev server, drives a real browser, runs your
        tests, then returns a verdict so you don&apos;t have to read every
        finding.
      </p>

      {/* Options */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px]">
        <OptionCheckbox
          label="Dev server"
          checked={opts.run_dev_server}
          onChange={(v) => setOpts({ ...opts, run_dev_server: v })}
          disabled={running}
        />
        <OptionCheckbox
          label="Drive browser"
          checked={opts.drive_browser}
          onChange={(v) => setOpts({ ...opts, drive_browser: v })}
          disabled={running || !opts.run_dev_server}
        />
        <OptionCheckbox
          label="Run tests"
          checked={opts.run_tests}
          onChange={(v) => setOpts({ ...opts, run_tests: v })}
          disabled={running}
        />
        {opts.drive_browser && (
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-secondary)]">Start path</span>
            <Input
              value={startPath}
              onChange={(e) => setStartPath(e.target.value)}
              placeholder="/login"
              disabled={running}
              className="h-6 w-28 font-mono text-[10px]"
            />
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="font-mono">{error}</span>
        </div>
      )}

      {/* Verdict (after run) */}
      {result && <VerdictBanner result={result} />}

      {/* Live phase log (during run) */}
      {(running || phases.length > 0) && (
        <PhaseTimeline phases={phases} running={running} />
      )}

      {/* Findings (if any) */}
      {result && result.findings.length > 0 && (
        <div className="mt-3">
          <div className="cv-label mb-1.5">Execution findings ({result.findings.length})</div>
          <div className="space-y-1.5">
            {result.findings.map((f, i) => (
              <div
                key={i}
                className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-surface)] p-2"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      f.severity === "high"
                        ? "border-red-500/40 bg-red-500/10 text-[10px] text-red-200"
                        : f.severity === "low"
                          ? "border-slate-500/40 bg-slate-500/10 text-[10px] text-slate-300"
                          : "border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-200"
                    }
                  >
                    {f.severity}
                  </Badge>
                  <span className="font-medium">{f.title}</span>
                  <Badge
                    variant="outline"
                    className="border-cyan-500/40 bg-cyan-500/10 text-[9px] text-[var(--cv-accent)]"
                  >
                    via execution
                  </Badge>
                </div>
                <p className="mt-1 text-[var(--text-secondary)]">{f.summary}</p>
                {f.evidence && (
                  <p className="mt-1 font-mono text-[10px] text-[var(--text-secondary)]">
                    evidence: {f.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible step trace */}
      {steps.filter((s) => s.kind === "agent").length > 0 && (
        <Collapsible
          open={showSteps}
          toggle={() => setShowSteps(!showSteps)}
          label={`Browser steps (${steps.filter((s) => s.kind === "agent").length})`}
        >
          <div className="mt-1 space-y-1 font-mono text-[10px]">
            {steps
              .filter((s): s is Extract<SandboxStep, { kind: "agent" }> => s.kind === "agent")
              .map((s, i) => (
                <div key={i} className="text-[var(--text-secondary)]">
                  <span className="text-[var(--cv-accent)]">{s.step.index}.</span>{" "}
                  {s.step.action.type} @ {s.step.url}
                  {s.step.error && (
                    <span className="text-red-300"> [error: {s.step.error}]</span>
                  )}
                </div>
              ))}
          </div>
        </Collapsible>
      )}

      {/* Collapsible test output */}
      {result?.test_result && (
        <Collapsible
          open={showTestOutput}
          toggle={() => setShowTestOutput(!showTestOutput)}
          label={`Test output — ${
            result.test_result.skipped_reason
              ? "skipped"
              : result.test_result.exit_code === 0
                ? "passed"
                : `exit ${result.test_result.exit_code}`
          }`}
        >
          <div className="mt-1 font-mono text-[10px]">
            <div className="text-[var(--text-secondary)]">
              $ {result.test_result.command || "(no command)"}
            </div>
            {result.test_result.skipped_reason && (
              <div className="mt-1 text-amber-300/80">
                {result.test_result.skipped_reason}
              </div>
            )}
            {result.test_result.stdout_tail && (
              <pre className="mt-1 whitespace-pre-wrap text-[var(--text-primary)]">
                {result.test_result.stdout_tail}
              </pre>
            )}
            {result.test_result.stderr_tail && (
              <pre className="mt-1 whitespace-pre-wrap text-red-300/80">
                {result.test_result.stderr_tail}
              </pre>
            )}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

function OptionCheckbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        disabled
          ? "flex cursor-not-allowed items-center gap-1.5 opacity-50"
          : "flex cursor-pointer items-center gap-1.5"
      }
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3 w-3 accent-[var(--cv-accent)]"
      />
      <span>{label}</span>
    </label>
  );
}

function VerdictBanner({ result }: { result: SandboxRunResult }) {
  const look = VERDICT_LOOK[result.verdict];
  const Icon = look.icon;
  return (
    <div
      className={`mb-2 flex items-start gap-2 rounded-md border ${look.border} ${look.bg} px-3 py-2`}
    >
      <Icon size={16} className={`${look.color} mt-0.5 shrink-0`} />
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${look.color}`}>{look.label}</span>
          <span className="text-[10px] text-[var(--text-secondary)]">
            confidence {(result.confidence * 100).toFixed(0)}%
          </span>
          <span className="text-[10px] text-[var(--text-secondary)]">
            · {(result.duration_ms / 1000).toFixed(1)}s
          </span>
        </div>
        <p className="mt-0.5 text-[var(--text-primary)]">{result.summary}</p>
      </div>
    </div>
  );
}

function PhaseTimeline({
  phases,
  running,
}: {
  phases: PhaseEvent[];
  running: boolean;
}) {
  if (phases.length === 0) return null;
  return (
    <div className="mb-2 rounded-md border border-[var(--cv-line)] bg-[var(--bg-surface)] p-2">
      <div className="cv-label mb-1">Live progress</div>
      <ol className="space-y-0.5">
        {phases.map((p, i) => {
          const isLast = i === phases.length - 1;
          const stillRunning = running && isLast && p.phase !== "done";
          return (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              {stillRunning ? (
                <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-[var(--cv-accent)]" />
              ) : (
                <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-400/60" />
              )}
              <span className="text-[var(--text-primary)]">
                {PHASE_LABELS[p.phase] ?? p.phase}
              </span>
              {p.detail && (
                <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                  · {p.detail}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Collapsible({
  open,
  toggle,
  label,
  children,
}: {
  open: boolean;
  toggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 border-t border-[var(--cv-line)]/60 pt-2">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1 text-left text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {label}
      </button>
      {open && children}
    </div>
  );
}

// Avoid an unused-import warning on HelpCircle (kept for a future "what does
// each option do" tooltip — explicitly held).
void HelpCircle;
