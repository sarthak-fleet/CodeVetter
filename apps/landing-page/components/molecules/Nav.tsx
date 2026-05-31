"use client";

import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/atoms/Button";

const links = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#providers", label: "Providers" },
  { href: "#pricing", label: "Pricing" },
];

export function Nav() {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      className="fixed top-6 inset-x-0 z-50 flex justify-center px-6 pointer-events-none"
    >
      <div className="corner-frame flex items-center justify-between w-full max-w-5xl h-14 px-5 border border-[--color-line] bg-[--color-bg]/75 backdrop-blur-xl shadow-2xl pointer-events-auto">
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="relative">
            <ShieldCheck className="w-5 h-5 text-[--color-accent]" strokeWidth={1.5} />
            <span className="absolute -inset-1 rounded-full bg-[--color-accent]/20 blur-md opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <span className="font-mono text-[13px] tracking-[0.2em] uppercase font-semibold text-white">
            CodeVetter
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-[--color-text-dim] hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" href="https://github.com/sarthak-fleet/CodeVetter" className="hidden sm:inline-flex h-9 px-4 text-xs">
            GitHub
          </Button>
          <Button variant="primary" href="#download" className="h-9 px-5 text-xs">
            Download
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
