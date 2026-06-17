import { Activity, ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Monitor, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getResourceSnapshot, isTauriAvailable, type ResourceSnapshot } from "@/lib/tauri-ipc";

const REFRESH_MS = 2000;

function bytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${n}B`;
}

function rate(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M/s`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K/s`;
  return `${n}B/s`;
}

function cpuTone(pct: number): string {
  if (pct >= 70) return "text-rose-300";
  if (pct >= 30) return "text-amber-300";
  return "text-slate-300";
}

function ramTone(b: number): string {
  if (b >= 1.5 * 1024 ** 3) return "text-rose-300";
  if (b >= 500 * 1024 ** 2) return "text-amber-300";
  return "text-slate-300";
}

function ioTone(b: number): string {
  if (b >= 50 * 1024 ** 2) return "text-rose-300";
  if (b >= 5 * 1024 ** 2) return "text-amber-300";
  return "text-slate-300";
}

export default function ResourceChip() {
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const s = await getResourceSnapshot();
        if (!cancelled) setSnap(s);
      } catch {
        // ignore — the chip simply doesn't update
      }
      if (!cancelled) timer = setTimeout(tick, REFRESH_MS);
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Click-outside-to-close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!snap) return null;

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-full bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-400 hover:bg-white/[0.07]"
          >
            <span className={`flex items-center gap-1 ${cpuTone(snap.cpu_percent)}`}>
              <Cpu size={11} /> {snap.cpu_percent.toFixed(0)}%
            </span>
            <span className="text-slate-700">·</span>
            <span className={`flex items-center gap-1 ${ramTone(snap.ram_bytes)}`}>
              <MemoryStick size={11} /> {bytes(snap.ram_bytes)}
            </span>
            <span className="text-slate-700">·</span>
            <span className={`flex items-center gap-1 ${ioTone(snap.disk_write_per_sec)}`}>
              <HardDrive size={11} /> {rate(snap.disk_write_per_sec)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px]">
          Live resource usage · click for details
        </TooltipContent>
      </Tooltip>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-[calc(100%+8px)] right-0 z-[60] w-[360px] cv-frame bg-[#07080a]/95 p-4 shadow-2xl backdrop-blur-md"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="cv-label text-slate-300">CodeVetter resources</span>
            <span className="font-mono text-[9px] text-slate-600">
              PID {snap.self_pid} · {snap.cpu_count} cores
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-[var(--cv-line)] pb-3">
            <Metric icon={<Cpu size={12} />} label="CPU" value={`${snap.cpu_percent.toFixed(1)}%`} tone={cpuTone(snap.cpu_percent)} />
            <Metric icon={<MemoryStick size={12} />} label="RAM" value={bytes(snap.ram_bytes)} tone={ramTone(snap.ram_bytes)} />
            <Metric icon={<ArrowDown size={12} />} label="Disk read" value={rate(snap.disk_read_per_sec)} tone={ioTone(snap.disk_read_per_sec)} />
            <Metric icon={<HardDrive size={12} />} label="Disk write" value={rate(snap.disk_write_per_sec)} tone={ioTone(snap.disk_write_per_sec)} />
            <Metric
              icon={<Monitor size={12} />}
              label="GPU"
              value={snap.gpu_percent == null ? "—" : `${snap.gpu_percent.toFixed(0)}%`}
              tone="text-slate-300"
            />
            <Metric
              icon={<Wifi size={12} />}
              label="Network"
              value={
                snap.net_in_per_sec == null
                  ? "—"
                  : `↓${rate(snap.net_in_per_sec)} ↑${rate(snap.net_out_per_sec)}`
              }
              tone="text-slate-300"
            />
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="cv-label text-slate-500">Child processes</span>
              <span className="font-mono text-[9px] text-slate-600">{snap.children.length}</span>
            </div>
            {snap.children.length === 0 ? (
              <div className="font-mono text-[10px] text-slate-600">none</div>
            ) : (
              <ul className="max-h-[180px] space-y-1 overflow-y-auto">
                {snap.children.slice(0, 20).map((c) => (
                  <li
                    key={c.pid}
                    className="flex items-center justify-between font-mono text-[10px] text-slate-400"
                  >
                    <span className="truncate pr-2">
                      <span className="text-slate-600">{c.pid}</span>{" "}
                      <span className="text-slate-300">{c.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cpuTone(c.cpu_percent)}>{c.cpu_percent.toFixed(0)}%</span>
                      <span className={ramTone(c.ram_bytes)}>{bytes(c.ram_bytes)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[var(--cv-line)] pt-2">
            <span className="flex items-center gap-1 font-mono text-[9px] text-slate-600">
              <Activity size={9} /> refreshed every {REFRESH_MS / 1000}s
            </span>
            <span className="font-mono text-[9px] text-slate-600">
              {new Date(snap.sampled_at).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}

function Metric({ icon, label, value, tone }: MetricProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
        {icon} {label}
      </span>
      <span className={`font-mono text-[11px] ${tone}`}>{value}</span>
    </div>
  );
}
