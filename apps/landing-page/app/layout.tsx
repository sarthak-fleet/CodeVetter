import "./globals.css";

import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "CodeVetter — Vet AI-generated code before it ships",
  description:
    "Desktop-first code review for agent-generated code. Runs offline. Multi-LLM. Catches what your agent misses.",
  metadataBase: new URL("https://codevetter.dev"),
  openGraph: {
    title: "CodeVetter",
    description:
      "Desktop-first code review for agent-generated code. Runs offline. Multi-LLM.",
    type: "website",
  },
};

const posthogKey =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_qgiAarw4Co4pw9fz3Fxj4UJaHmqzFetqs4JrXhGc35Nd";
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Script src="https://us-assets.i.posthog.com/static/array.js" strategy="afterInteractive" />
        <Script id="foundry-monitoring" strategy="afterInteractive">
          {`
            (function () {
              var key = ${JSON.stringify(posthogKey)};
              var host = ${JSON.stringify(posthogHost)};
              function capturePageCrash(error, source) {
                var message = error && error.message ? error.message : String(error);
                var payload = {
                  project_slug: "CodeVetter",
                  route: location.origin + location.pathname,
                  source: source,
                  message: message,
                  stack: error && error.stack ? error.stack : undefined
                };
                if (window.posthog && typeof window.posthog.capture === "function") {
                  window.posthog.capture("foundry_page_crash", payload);
                } else {
                  console.warn("foundry_page_crash", payload);
                }
              }
              window.addEventListener("error", function (event) {
                capturePageCrash(event.error || event.message, "window_error");
              });
              window.addEventListener("unhandledrejection", function (event) {
                capturePageCrash(event.reason, "unhandled_rejection");
              });
              if (key && window.posthog && typeof window.posthog.init === "function") {
                window.posthog.init(key, { api_host: host, capture_pageview: false, autocapture: false });
              }
            })();
          `}
        </Script>
      </body>
    </html>
  );
}
