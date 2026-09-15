---
name: dc-flow-compare
description: >-
  Compare Salesforce Data Capture Flow versions using the same diff engine as the
  Data Capture Flow Compare VSIX. Use when the user asks to compare Flow versions,
  Data Capture flows, flow-meta.xml files, org flow versions, renames/retargets in
  flows, or run dc-flow-compare.
---

# Data Capture Flow Compare (Cursor)

Uses the **same TypeScript diff engine** as the VSIX via CLI.

## Why approvals / missing tables happen

- Cursor asks approval **per shell call**. Many small commands = many approvals.
- If the agent “summarizes,” the markdown table is dropped.

## Required behavior

1. Run **one** combined shell (build if needed + compare). No `sf org list` unless asked.
2. Always use `--format table`.
3. **Prefer a Cursor Canvas** for the summary table when there are many rows or the user asks for canvas. Chat gets counts + ≤3 highlights + a link to the `.canvas.tsx`. Tiny diffs (<15 rows) may paste the CLI table in chat. Never replace the table with bullets only.
4. **Canvas columns must match the VSIX summary exactly** (use `--format json` / `buildUnifiedRows`):
   `Change Type` | `Label` | `API name` | `Element` (kind + propertyLabel) | left version | right version.
   Change Type shows `added` / `removed` / `Updated` (for modified).

## One-shot command (org)

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && \
test -f extensions/data-capture-flow-compare/out/cli.js || npm --prefix extensions/data-capture-flow-compare run compile && \
node extensions/data-capture-flow-compare/bin/dc-flow-compare.js org FlowApiName \
  --left 1 --right 2 --org YourOrgAlias --project-dir . --format table
```

## One-shot command (local)

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && \
test -f extensions/data-capture-flow-compare/out/cli.js || npm --prefix extensions/data-capture-flow-compare run compile && \
node extensions/data-capture-flow-compare/bin/dc-flow-compare.js local \
  left.flow-meta.xml right.flow-meta.xml --format table
```

## Subagent

Prefer `.cursor/agents/dc-flow-compare.md` for dedicated compares.
