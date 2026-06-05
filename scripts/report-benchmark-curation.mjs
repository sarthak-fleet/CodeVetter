#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_FIXTURE = "benchmarks/agent-prs/cases";
const REQUIRED_REVIEWERS = ["codevetter", "coderabbit_free", "claude_code_review"];

function parseArgs(argv) {
  const fixture = argv.find((arg) => !arg.startsWith("--")) ?? DEFAULT_FIXTURE;
  const formatArg = argv.find((arg) => arg.startsWith("--format="));
  const format = formatArg?.slice("--format=".length) ?? "text";
  return { fixture, format };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readCases(fixturePath) {
  const abs = path.resolve(process.cwd(), fixturePath);
  if (!fs.existsSync(abs)) {
    return [];
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(abs)
      .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
      .sort()
      .map((name) => readJsonFile(path.join(abs, name)));
  }
  const parsed = readJsonFile(abs);
  return Array.isArray(parsed.cases) ? parsed.cases : [parsed];
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "" && !/\bTODO\b/i.test(value);
}

function caseIssues(testCase) {
  const issues = [];
  if (!hasValue(testCase.id)) issues.push("missing id");
  if (!hasValue(testCase.title)) issues.push("missing title");
  if (!hasValue(testCase.source?.repo)) issues.push("missing source.repo");
  if (!hasValue(testCase.source?.pr_url)) issues.push("missing source.pr_url");
  if (!hasValue(testCase.source?.diff_range)) issues.push("missing source.diff_range");
  if (!hasValue(testCase.source?.agent)) issues.push("missing source.agent");
  if (!hasValue(testCase.source?.raw_diff_artifact)) {
    issues.push("missing source.raw_diff_artifact");
  }
  for (const reviewer of REQUIRED_REVIEWERS) {
    if (!hasValue(testCase.source?.review_output_artifacts?.[reviewer])) {
      issues.push(`missing source.review_output_artifacts.${reviewer}`);
    }
  }

  if (!Array.isArray(testCase.ground_truth) || testCase.ground_truth.length === 0) {
    issues.push("missing ground_truth");
  } else {
    for (const [idx, issue] of testCase.ground_truth.entries()) {
      if (!hasValue(issue.id)) issues.push(`ground_truth[${idx}] missing id`);
      if (!hasValue(issue.severity)) issues.push(`ground_truth[${idx}] missing severity`);
      if (!hasValue(issue.title)) issues.push(`ground_truth[${idx}] missing title`);
      if (!hasValue(issue.evidence)) issues.push(`ground_truth[${idx}] missing evidence`);
    }
  }

  const issueIds = new Set((testCase.ground_truth ?? []).map((issue) => issue.id));
  const reviews = testCase.reviews ?? {};
  for (const reviewer of REQUIRED_REVIEWERS) {
    if (!Array.isArray(reviews[reviewer])) {
      issues.push(`missing reviews.${reviewer}`);
    }
  }
  for (const [reviewer, findings] of Object.entries(reviews)) {
    if (!Array.isArray(findings)) {
      issues.push(`reviews.${reviewer} must be an array`);
      continue;
    }
    for (const [idx, finding] of findings.entries()) {
      if (!hasValue(finding.title)) issues.push(`reviews.${reviewer}[${idx}] missing title`);
      const matches = finding.matched_ground_truth ?? [];
      if (!Array.isArray(matches)) {
        issues.push(`reviews.${reviewer}[${idx}] matched_ground_truth must be an array`);
        continue;
      }
      for (const id of matches) {
        if (!issueIds.has(id)) {
          issues.push(`reviews.${reviewer}[${idx}] references unknown issue ${id}`);
        }
      }
      if (matches.length > 0 && !hasValue(finding.match_rationale)) {
        issues.push(`reviews.${reviewer}[${idx}] missing match_rationale`);
      }
    }
  }

  return issues;
}

function summarize(cases) {
  const rows = cases.map((testCase) => ({
    id: testCase.id ?? "(missing id)",
    title: testCase.title ?? "",
    issues: caseIssues(testCase),
  }));
  const ready = rows.filter((row) => row.issues.length === 0).length;
  return {
    total_cases: rows.length,
    ready_cases: ready,
    incomplete_cases: rows.length - ready,
    rows,
  };
}

const { fixture, format } = parseArgs(process.argv.slice(2));
if (!["text", "json"].includes(format)) {
  console.error("--format must be one of: text, json");
  process.exit(1);
}

let cases;
try {
  cases = readCases(fixture);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const report = summarize(cases);
if (format === "json") {
  console.log(JSON.stringify({ fixture, ...report }, null, 2));
} else {
  console.log(`Benchmark curation: ${report.ready_cases}/${report.total_cases} ready`);
  if (report.incomplete_cases > 0) {
    console.log(`Incomplete: ${report.incomplete_cases}`);
  }
  for (const row of report.rows) {
    const status = row.issues.length === 0 ? "ready" : `${row.issues.length} issue(s)`;
    console.log(`- ${row.id}: ${status}`);
    for (const issue of row.issues.slice(0, 5)) {
      console.log(`  - ${issue}`);
    }
    if (row.issues.length > 5) {
      console.log(`  - ${row.issues.length - 5} more`);
    }
  }
}
