import Link from "next/link";

import { Footer } from "@/components/molecules/Footer";
import { Nav } from "@/components/molecules/Nav";

export const metadata = {
  title: "Download — CodeVetter",
  description: "Install CodeVetter for macOS, Windows, or Linux.",
};

interface Platform {
  name: string;
  arch: string;
  asset: string;
  command?: string;
}

const PLATFORMS: Platform[] = [
  {
    name: "macOS — Apple Silicon",
    arch: "arm64",
    asset: "CodeVetter_*_aarch64.dmg",
    command: "Open the .dmg, drag CodeVetter to Applications.",
  },
  {
    name: "macOS — Intel",
    arch: "x86_64",
    asset: "CodeVetter_*_x64.dmg",
    command: "Open the .dmg, drag CodeVetter to Applications.",
  },
  {
    name: "Windows",
    arch: "x86_64",
    asset: "CodeVetter_*_x64-setup.exe",
    command: "Run the installer.",
  },
  {
    name: "Linux — .deb",
    arch: "x86_64",
    asset: "code-vetter_*_amd64.deb",
    command: "sudo dpkg -i code-vetter_*_amd64.deb",
  },
  {
    name: "Linux — AppImage",
    arch: "x86_64",
    asset: "code-vetter_*_amd64.AppImage",
    command: "chmod +x code-vetter_*_amd64.AppImage && ./code-vetter_*_amd64.AppImage",
  },
];

export default function DownloadPage() {
  return (
    <main className="min-h-screen bg-stone-950 text-stone-200">
      <Nav />
      <article className="mx-auto max-w-3xl px-4 py-16">
        <Link href="/" className="text-xs text-stone-500 hover:text-amber-400">
          ← CodeVetter
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
          Download
        </h1>
        <p className="mt-3 text-sm leading-7 text-stone-400">
          Native desktop binaries. Local-first; no signup. Auto-updates from
          GitHub Releases — disable in settings if you prefer manual control.
        </p>

        <a
          href="https://github.com/sarthak-fleet/CodeVetter/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400"
        >
          Latest release →
        </a>

        <section className="mt-10 space-y-3">
          {PLATFORMS.map((p) => (
            <div
              key={p.name + p.arch}
              className="rounded-md border border-stone-800 bg-stone-900/40 p-4"
            >
              <p className="text-sm font-medium text-white">{p.name}</p>
              <p className="mt-1 font-mono text-xs text-stone-500">{p.asset}</p>
              {p.command && (
                <p className="mt-2 text-xs text-stone-400">{p.command}</p>
              )}
            </div>
          ))}
        </section>

        <p className="mt-10 text-xs text-stone-500">
          Building from source? See the{" "}
          <a
            href="https://github.com/sarthak-fleet/CodeVetter"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-400"
          >
            repo README
          </a>{" "}
          — Tauri 2 + React 19 + Rust, npm workspaces.
        </p>
      </article>
      <Footer />
    </main>
  );
}
