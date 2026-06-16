import { Bot, FolderOpen, Loader2, MessageSquare, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
  askCodevetter,
  type AskResult,
  getPreference,
  isTauriAvailable,
  pickDirectory,
  setPreference,
} from "@/lib/tauri-ipc";

const REPO_PATH_KEY = "ask_last_repo";

interface QAItem {
  question: string;
  answer: AskResult | null;
  error: string | null;
  pending: boolean;
}

const EXAMPLE_QUESTIONS = [
  "Which project shipped the most last week?",
  "Where is my code review attention needed next?",
  "Am I going faster since adopting Claude Code?",
  "Which fleet projects have the most rework / hotfix activity?",
  "Where is human work concentrated vs AI work in this repo?",
];

export default function Ask() {
  const [question, setQuestion] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [includeFleet, setIncludeFleet] = useState(true);
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [history, setHistory] = useState<QAItem[]>([]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    void (async () => {
      try {
        const last = await getPreference(REPO_PATH_KEY);
        if (last) setRepoPath(last);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const handlePick = useCallback(async () => {
    if (!isTauriAvailable()) return;
    const picked = await pickDirectory("Select a repository to ground answers in");
    if (picked) {
      setRepoPath(picked);
      try {
        await setPreference(REPO_PATH_KEY, picked);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || !isTauriAvailable()) return;
    const item: QAItem = { question: q, answer: null, error: null, pending: true };
    setHistory((prev) => [...prev, item]);
    setQuestion("");
    try {
      const result = await askCodevetter({
        question: q,
        repo_path: repoPath || null,
        include_fleet: includeFleet,
        provider,
      });
      setHistory((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex(
          (x) => x.question === q && x.pending,
        );
        if (idx >= 0) copy[idx] = { ...item, answer: result, pending: false };
        return copy;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setHistory((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex(
          (x) => x.question === q && x.pending,
        );
        if (idx >= 0) copy[idx] = { ...item, error: msg, pending: false };
        return copy;
      });
    }
  }, [question, repoPath, includeFleet, provider]);

  return (
    <div className="mx-auto max-w-4xl px-6 pb-24 pt-20">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare size={22} className="text-[var(--cv-accent)]" />
          <h1 className="text-2xl font-semibold tracking-tight">Ask CodeVetter</h1>
          <Badge
            variant="outline"
            className="border-cyan-500/40 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-[var(--cv-accent)]"
          >
            Beta
          </Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Natural-language Q&A over your fleet rollup, repo attribution, and
          DORA metrics. Runs locally via{" "}
          <span className="font-mono">claude</span> or{" "}
          <span className="font-mono">codex</span> CLI; nothing leaves the
          machine except the prompt text.
        </p>
      </header>

      <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot size={16} className="text-[var(--cv-accent)]" />
            Grounding
          </CardTitle>
          <CardDescription className="text-xs">
            Pick a repo to ground answers in. Toggle fleet context to give the
            model cross-project awareness.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={repoPath}
              placeholder="/Users/me/code/my-repo (optional)"
              onChange={(e) => setRepoPath(e.target.value)}
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={handlePick}>
              <FolderOpen size={14} className="mr-1.5" />
              Pick…
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeFleet}
                onChange={(e) => setIncludeFleet(e.target.checked)}
                className="h-3 w-3 accent-[var(--cv-accent)]"
              />
              <span>Include fleet rollup</span>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-secondary)]">Brain:</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as "claude" | "codex")}
                className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-[10px]"
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
        <CardContent className="pt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleAsk();
                }
              }}
              placeholder="Which project shipped the most last week?"
              className="text-sm"
            />
            <Button
              type="button"
              onClick={handleAsk}
              disabled={!question.trim()}
              size="sm"
            >
              <Send size={14} className="mr-1.5" />
              Ask
            </Button>
          </div>
          {history.length === 0 && (
            <div className="mt-3">
              <div className="cv-label mb-2">Try one of these</div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuestion(q)}
                    className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--cv-accent)]/40 hover:text-[var(--text-primary)]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <div className="space-y-4">
          {history.map((item, i) => (
            <Card
              key={i}
              className="border-[var(--cv-line)] bg-[var(--bg-surface)]"
            >
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start gap-2">
                  <Sparkles size={14} className="mt-1 shrink-0 text-[var(--cv-accent)]" />
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    {item.question}
                  </div>
                </div>
                {item.pending ? (
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Loader2 size={12} className="animate-spin" />
                    Reading your data, asking {provider}…
                  </div>
                ) : item.error ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {item.error}
                  </div>
                ) : item.answer ? (
                  <div className="space-y-2">
                    <pre className="whitespace-pre-wrap rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3 font-sans text-sm text-[var(--text-primary)]">
                      {item.answer.answer}
                    </pre>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
                      <span>via {item.answer.provider}</span>
                      <span>·</span>
                      <span>
                        {(item.answer.context_bytes / 1024).toFixed(1)}kb context
                      </span>
                      <span>·</span>
                      <span>{(item.answer.took_ms / 1000).toFixed(1)}s</span>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
