import { Apple, ArrowRight, ShieldCheck,Terminal } from "lucide-react";

import { Button } from "@/components/atoms/Button";

export function CTA() {
  return (
    <section
      id="download"
      className="py-32 relative overflow-hidden"
    >
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-40" aria-hidden />

      <div className="relative max-w-5xl mx-auto px-6">
        <div className="relative rounded-[3rem] bg-white/[0.02] border border-white/5 backdrop-blur-3xl p-12 md:p-20 overflow-hidden shadow-2xl">
          <div
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              background:
                "radial-gradient(circle at 50% 0%, rgba(96, 165, 250, 0.2), transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative text-center flex flex-col items-center">
            <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold tracking-widest uppercase mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Latest build · Ready to review
            </div>
            
            <h2 className="font-display text-[clamp(2.4rem,6vw,4.5rem)] font-bold leading-[1.1] tracking-tight text-white">
              Stop trusting agents{" "}
              <span className="text-gradient">blindly.</span>
            </h2>
            <p className="mt-8 text-lg text-gray-400 max-w-xl mx-auto leading-relaxed">
              Install in 30 seconds. First review in under a minute. Your code never
              leaves your machine.
            </p>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
              <Button
                variant="primary"
                href="https://github.com/sarthak-fleet/CodeVetter/releases/latest"
                className="h-14 px-8"
              >
                <Apple className="w-5 h-5" />
                Download for macOS
                <ArrowRight
                  className="w-4 h-4 transition-transform group-hover:translate-x-1"
                />
              </Button>
              <Button
                variant="glass"
                href="https://github.com/sarthak-fleet/CodeVetter/releases/latest"
                className="h-14 px-8"
              >
                Other Platforms
              </Button>
            </div>

            <div className="mt-12 w-full max-w-md rounded-2xl bg-black/40 border border-white/5 p-1 overflow-hidden backdrop-blur-md shadow-inner">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <Terminal className="w-4 h-4 text-blue-400" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Quick Install</span>
              </div>
              <div className="px-5 py-4 text-sm font-mono flex items-center gap-3">
                <span className="text-blue-500/50">❯</span>
                <span className="text-gray-300">brew install --cask <span className="text-white">codevetter</span></span>
              </div>
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-xs font-semibold text-gray-500">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400/70" />
                Signed binaries
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400/70" />
                Auto-updates
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400/70" />
                No account required
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}