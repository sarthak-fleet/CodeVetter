#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    id: null,
    title: null,
    repo: null,
    prUrl: null,
    diffRange: null,
    outPath: null,
    force: false,
  };
  for (const arg of argv) {
    if (arg === "--force") {
      out.force = true;
    } else if (arg.startsWith("--id=")) {
      out.id = arg.slice("--id=".length);
    } else if (arg.startsWith("--title=")) {
      out.title = arg.slice("--title=".length);
    } else if (arg.startsWith("--repo=")) {
      out.repo = arg.slice("--repo=".length);
    } else if (arg.startsWith("--pr-url=")) {
      out.prUrl = arg.slice("--pr-url=".length);
    } else if (arg.startsWith("--diff-range=")) {
      out.diffRange = arg.slice("--diff-range=".length);
    } else if (arg.startsWith("--out=")) {
      out.outPath = arg.slice("--out=".length);
    }
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  npm run bench:new-case -- --id=<case-id> --title=<title> --repo=<owner/repo-or-url> [--pr-url=<url>] [--diff-range=<base...head>] [--out=<path>] [--force]",
    "",
    "Creates one per-case benchmark JSON fixture. Fill TODO fields before running publishable gates.",
  ].join("\n");
}

function assertRequired(value, name, errors) {
  if (!value || !value.trim()) errors.push(`${name} is required`);
}

const args = parseArgs(process.argv.slice(2));
const errors = [];
assertRequired(args.id, "--id", errors);
assertRequired(args.title, "--title", errors);
assertRequired(args.repo, "--repo", errors);
if (errors.length) {
  console.error(usage());
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const caseId = args.id.trim();
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(caseId)) {
  console.error("--id must be filesystem-safe: letters, numbers, dots, underscores, and dashes");
  process.exit(1);
}

const outPath = path.resolve(
  process.cwd(),
  args.outPath ?? path.join("benchmarks/agent-prs/cases", `${caseId}.json`),
);
if (fs.existsSync(outPath) && !args.force) {
  console.error(`Refusing to overwrite existing file: ${outPath}`);
  console.error("Pass --force to overwrite.");
  process.exit(1);
}

const benchmarkCase = {
  id: caseId,
  title: args.title.trim(),
  source: {
    repo: args.repo.trim(),
    pr_url: args.prUrl?.trim() || "TODO-public-pr-url",
    diff_range: args.diffRange?.trim() || "TODO-base...head",
    agent: "TODO-agent-or-tool",
    raw_diff_artifact: "TODO-path-or-url-to-preserved-raw-diff",
    review_output_artifacts: {
      codevetter: "TODO-path-or-url-to-codevetter-output",
      coderabbit_free: "TODO-path-or-url-to-coderabbit-free-output",
      claude_code_review: "TODO-path-or-url-to-claude-code-review-output",
    },
  },
  ground_truth: [
    {
      id: "TODO-issue-id",
      severity: "medium",
      filePath: "TODO/path/to/file",
      title: "TODO hand-labeled issue title",
      evidence: "TODO exact reason this is a real bug, with diff/test/user-impact evidence.",
    },
  ],
  reviews: {
    codevetter: [
      {
        severity: "medium",
        filePath: "TODO/path/to/file",
        title: "TODO CodeVetter finding title",
        matched_ground_truth: ["TODO-issue-id"],
        match_rationale: "TODO why this finding catches the ground-truth issue.",
      },
    ],
    coderabbit_free: [],
    claude_code_review: [],
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(benchmarkCase, null, 2)}\n`);
console.log(`Created ${path.relative(process.cwd(), outPath)}`);
