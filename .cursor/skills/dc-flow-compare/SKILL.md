---
name: dc-flow-compare
description: >-
  Compare Salesforce Data Capture Flow versions using the same diff engine as the
  Data Capture Flow Compare VSIX. Use when the user asks to compare Flow versions,
  Data Capture flows, flow-meta.xml files, org flow versions, renames/retargets in
  flows, or run dc-flow-compare.
---

# Data Capture Flow Compare (Cursor)

Uses the **same TypeScript diff engine** as the VSIX (`flowDiff` / `unifiedTable`) via CLI.

## Cursor surfaces

- **Skill:** `.cursor/skills/dc-flow-compare/SKILL.md` (main agent guidance)
- **Subagent:** `.cursor/agents/dc-flow-compare.md` (dedicated compare agent)

## Prerequisites

- Salesforce CLI (`sf`) on PATH for **org** compares
- Authenticated org alias for org mode
- SFDX project open (repo root with `sfdx-project.json`) for org retrieve
- Extension package built: `extensions/data-capture-flow-compare` (`npm run compile`)

## CLI path

```bash
node extensions/data-capture-flow-compare/bin/dc-flow-compare.js
# or after compile:
npm --prefix extensions/data-capture-flow-compare run cli -- <args>
```

## Workflow

1. If inputs are missing, ask for: mode (`local` | `org`), flow API name / file paths, versions, org alias(es).
2. Compile if `out/cli.js` is missing: `npm --prefix extensions/data-capture-flow-compare run compile`
3. Run the CLI (prefer `--format table`).
4. Paste/summarize the CLI output for the user. Do **not** invent a separate AI diff.
5. Optionally suggest opening the VSIX summary UI for filters/export/XML jump.

## Commands

### Local files

```bash
node extensions/data-capture-flow-compare/bin/dc-flow-compare.js local \
  /path/to/Flow-v36.flow-meta.xml \
  /path/to/Flow-v37.flow-meta.xml \
  --format table
```

### Same org, two versions

```bash
node extensions/data-capture-flow-compare/bin/dc-flow-compare.js org FlowApiName \
  --left 36 --right 37 \
  --org YourOrgAlias \
  --project-dir . \
  --format table
```

### Cross-org

```bash
node extensions/data-capture-flow-compare/bin/dc-flow-compare.js org FlowApiName \
  --left 10 --right 12 \
  --left-org DevAlias \
  --right-org UatAlias \
  --project-dir . \
  --format table
```

### Other formats

- `--format markdown` — sectioned markdown (same family as VSIX export)
- `--format json` — unified rows JSON

## Output rules

- Treat CLI stdout as source of truth for changes.
- Highlight Updated renames (`previous → current`), assignment retargets, and brief field adds.
- Do not claim Chrome-extension or session-scraping auth; org mode uses `sf` OAuth only.

## When not to use

- Non-Flow Salesforce metadata compares
- Building LWC/Agentforce ports (out of scope for this skill)
