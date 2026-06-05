# CodeVetter Catch-Rate Benchmark

This is the starter harness for measuring whether CodeVetter catches known bugs in agent-generated changes.

Run:

```bash
npm run bench:catch-rate
npm run bench:catch-rate -- benchmarks/agent-prs/sample.json --reviewer=codevetter
npm run bench:catch-rate -- --reviewer=codevetter --baseline=baseline
npm run bench:catch-rate -- --reviewer=codevetter --baseline=coderabbit_free
npm run bench:catch-rate -- --reviewer=codevetter --baseline=claude_code_review
npm run bench:catch-rate -- --reviewer=codevetter --min-rate=0.8
npm run bench:catch-rate -- --reviewer=codevetter --max-false-positives=1
npm run bench:catch-rate -- --reviewer=codevetter --max-redundant-matches=0
npm run bench:catch-rate -- --reviewer=codevetter --min-severity-rate=high:1
npm run bench:catch-rate -- --reviewer=codevetter --require-rationales
npm run bench:catch-rate -- --json
npm run bench:catch-rate -- --format=markdown --out=artifacts/benchmark.md
npm run bench:new-case -- --id=owner-repo-pr-123 --title="Agent regresses checkout state" --repo=owner/repo --pr-url=https://github.com/owner/repo/pull/123
npm run bench:curation -- benchmarks/agent-prs/cases
# after adding at least one benchmarks/agent-prs/cases/*.json file
npm run bench:catch-rate -- benchmarks/agent-prs/cases --reviewer=codevetter
npm run test:benchmark
```

Fixture contract:

- Fixtures can be one combined JSON file with `cases[]`, one per-case JSON file, or a directory of per-case JSON files.
- `ground_truth`: hand-labeled issues that should be caught.
- `reviews.<reviewer>`: findings emitted by CodeVetter or a comparator.
- `matched_ground_truth`: issue ids the finding correctly catches.
- Findings with empty `matched_ground_truth` count as false positives.
- Strict mode is on by default and requires each case to include `source.repo`; pass `--no-strict` only for scratch fixtures.
- Publishable-fixture mode: `--require-rationales` requires non-placeholder `ground_truth[].evidence` and `reviews.<reviewer>[].match_rationale` on every matched finding.

Curation workflow:

1. Create one starter file per public PR with `npm run bench:new-case -- --id=<case-id> --title=<title> --repo=<owner/repo> --pr-url=<url>`.
2. Preserve source evidence in `source`: public PR URL, diff range, agent/tool name, raw diff artifact, CodeVetter output, CodeRabbit free-tier output, and Claude Code `/review` output.
3. Replace every `TODO` with hand-labeled evidence before publishable scoring.
4. Run `npm run bench:curation -- benchmarks/agent-prs/cases` until every case is ready.
5. Run `npm run bench:catch-rate -- benchmarks/agent-prs/cases --reviewer=codevetter --require-rationales`.

Curation readiness checks:

- public source metadata: repo, PR URL, diff range, and agent/tool name,
- preserved raw diff artifact,
- preserved CodeVetter, CodeRabbit free-tier, and Claude Code `/review` output artifacts,
- review arrays for `codevetter`, `coderabbit_free`, and `claude_code_review` (empty arrays are allowed when a tool produced no findings),
- hand-labeled ground truth with non-placeholder evidence,
- matched review findings with non-placeholder rationales.

Metrics:

- Overall catch rate: matched ground-truth issues divided by expected issues.
- By-severity catch rate: the same calculation grouped by `severity`.
- False positives: reviewer findings that do not match any ground-truth issue.
- Redundant matches: repeated matches to a ground-truth issue already caught by another finding in the same case.
- Precision: caught ground-truth issues divided by caught issues plus false positives plus redundant matches.
- F1: harmonic mean of catch rate and precision.
- Baseline comparison: `--baseline=<reviewer>` reports caught/rate/false-positive deltas.
- Gate mode: `--min-rate=<0..1>` exits non-zero when a selected reviewer falls below the threshold.
- False-positive gate mode: `--max-false-positives=<n>` exits non-zero when a selected reviewer reports more unmatched findings than allowed.
- Redundant-match gate mode: `--max-redundant-matches=<n>` exits non-zero when a selected reviewer repeats already-caught ground-truth matches too often.
- Severity gate mode: `--min-severity-rate=<severity>:<0..1>` exits non-zero when a selected reviewer falls below the threshold for that severity. Repeat the flag for multiple severities.
- Report output: `--format=text|json|markdown` controls stdout format. `--json` is equivalent to `--format=json`.
- Durable artifact output: `--out=<path>` writes JSON or Markdown reports to disk. Text mode writes a Markdown report to `--out` while keeping the human text summary on stdout.
- Rationale gate: `--require-rationales` exits non-zero if hand-labeled bugs or matched findings lack evidence/rationale text.

The included sample is not a publishable benchmark. It only proves the harness shape. Before making external claims, curate 20-30 real public agent PRs with known bugs, preserve raw diffs and review outputs, and record why each finding matches or misses ground truth.

`npm run test:benchmark` exercises the CLI gates against the sample fixture and generated temporary fixtures: rationale enforcement, TODO-placeholder rejection, directory/per-case fixture loading, curation readiness reporting, false-positive limits, duplicate match accounting, JSON metrics, and Markdown artifact output.
