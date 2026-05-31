import { Github, Mail,SearchCode, Twitter } from "lucide-react";
import type React from "react";

type ColItem = { l: string; h: string; icon?: React.ReactElement };

const cols: { label: string; items: ColItem[] }[] = [
  {
    label: "Product",
    items: [
      { l: "Features", h: "#features" },
      { l: "How it works", h: "#how" },
      { l: "Pricing", h: "#pricing" },
      { l: "Changelog", h: "https://github.com/sarthak-fleet/CodeVetter/releases" },
    ],
  },
  {
    label: "Resources",
    items: [
      { l: "Documentation", h: "https://github.com/sarthak-fleet/CodeVetter#readme" },
      { l: "Security Hub", h: "#" },
      { l: "Bug Bounty", h: "#" },
    ],
  },
  {
    label: "Connect",
    items: [
      { l: "GitHub", h: "https://github.com/sarthak-fleet/CodeVetter", icon: <Github className="w-3.5 h-3.5" /> },
      { l: "Twitter", h: "#", icon: <Twitter className="w-3.5 h-3.5" /> },
      { l: "Email", h: "mailto:hello@codevetter.dev", icon: <Mail className="w-3.5 h-3.5" /> },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-white/5 bg-[#050505] pt-24 pb-12 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
      
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-6 gap-12">
        <div className="col-span-2 space-y-6">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20">
              <SearchCode className="w-4 h-4 text-blue-400" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              CodeVetter
            </span>
          </div>
          <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
            Beautiful, desktop-first code review for the agent era. Built by engineers who want to ship AI code with confidence.
          </p>
          <div className="flex items-center gap-3 text-emerald-400 text-xs font-mono bg-emerald-500/5 border border-emerald-500/10 w-fit px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            All systems operational
          </div>
        </div>
        
        {cols.map((c) => (
          <div key={c.label} className="col-span-1">
            <div className="text-xs font-bold text-white uppercase tracking-widest mb-6">
              {c.label}
            </div>
            <ul className="space-y-4">
              {c.items.map((it) => (
                <li key={it.l}>
                  <a
                    href={it.h}
                    className="flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors group"
                  >
                    {it.icon && <span className="text-gray-600 group-hover:text-blue-400 transition-colors">{it.icon}</span>}
                    {it.l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      
      <div className="max-w-7xl mx-auto px-6 mt-24 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 text-xs text-gray-600 font-medium">
        <div className="flex items-center gap-6">
          <span>© {new Date().getFullYear()} CodeVetter · ISC License</span>
          <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
          <a
            href="https://github.com/sarthak-fleet/CodeVetter"
            className="hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span>Open-source desktop code review</span>
        </div>
      </div>
    </footer>
  );
}