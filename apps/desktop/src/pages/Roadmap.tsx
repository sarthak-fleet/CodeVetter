import { Activity, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { SessionAdapterRun, SessionScorecard } from "@/lib/tauri-ipc";
import {
  getAiSessionScorecard,
  listAiSessionAdapterRuns,
} from "@/lib/tauri-ipc";
import {
  AdapterSourceHealthPanel,
  RoadmapReleaseBanner,
  SessionScorecardPanel,
  VerificationWorkbenchPanel,
} from "@/pages/Home";

export default function Roadmap() {
  const [scorecard, setScorecard] = useState<SessionScorecard | null>(null);
  const [adapterRuns, setAdapterRuns] = useState<SessionAdapterRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRoadmap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scorecardResult, adapterRunsResult] = await Promise.all([
        getAiSessionScorecard({ limit: 50 }),
        listAiSessionAdapterRuns({ limit: 12 }),
      ]);
      setScorecard(scorecardResult);
      setAdapterRuns(adapterRunsResult);
    } catch (err) {
      console.error("[CodeVetter] Roadmap load failed:", err);
      setError("Couldn't load roadmap telemetry. Your saved data is safe.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoadmap();
  }, [loadRoadmap]);

  return (
    <div className="min-h-full overflow-y-auto overflow-x-hidden px-5 pb-8 pt-20">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="cv-label text-slate-500">roadmap</div>
            <h1 className="mt-1 truncate text-lg font-semibold tracking-normal text-slate-100">
              Shipped verification surfaces
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadRoadmap()}
            disabled={loading}
            className="h-10 shrink-0 justify-center gap-2 border-[#262626] bg-[#08090a] px-4 text-slate-300 hover:border-[var(--cv-accent)]/40 hover:text-slate-100"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="cv-panel flex items-center gap-3 border-red-500/25 bg-red-500/5 px-4 py-3">
            <Activity size={14} className="text-red-300" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        <RoadmapReleaseBanner />
        <VerificationWorkbenchPanel scorecard={scorecard} />
        <SessionScorecardPanel scorecard={scorecard} />
        <AdapterSourceHealthPanel runs={adapterRuns} />
      </div>
    </div>
  );
}
