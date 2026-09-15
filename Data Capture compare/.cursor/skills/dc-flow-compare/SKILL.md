---
name: dc-flow-compare
description: >-
  Compare Salesforce Data Capture Flow versions using the same diff engine as the
  Data Capture Flow Compare VSIX. Global skill — works in any open project. Use
  when the user asks to compare Flow versions, Data Capture flows, flow-meta.xml
  files, org flow versions, renames/retargets, or run dc-flow-compare.
---

# Data Capture Flow Compare (global Cursor skill)

Uses the **same TypeScript diff engine** as the VSIX via a **machine-global CLI**.

## Install location (this machine)

```text
CLI:   ~/.cursor/tools/dc-flow-compare
Agent: ~/.cursor/agents/dc-flow-compare.md
Skill: ~/.cursor/skills/dc-flow-compare/SKILL.md
Bin:   ~/.local/bin/dc-flow-compare  → CLI
```

Do **not** require `extensions/data-capture-flow-compare` inside the open project.

`--project-dir` = currently open DX project root (`git rev-parse --show-toplevel` or `pwd`).

## Required behavior

1. Run **one** combined shell (compile tool if needed + compare). No `sf org list` unless asked.
2. Prefer `--format table` for tiny diffs; `--format json` when building a Canvas.
3. **Prefer a Cursor Canvas** for many rows. Chat: counts + ≤3 highlights + canvas link.
4. **Canvas columns = VSIX summary:** Change Type | Label | API name | Element (kind + propertyLabel) | left | right.  
   Change Type: `added` / `removed` / `Updated`.

## One-shot command (org)

```bash
PROJECT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && \
TOOL="$HOME/.cursor/tools/dc-flow-compare" && \
test -f "$TOOL/out/cli.js" || npm --prefix "$TOOL" run compile && \
(command -v dc-flow-compare >/dev/null && dc-flow-compare || node "$TOOL/bin/dc-flow-compare.js") \
  org FlowApiName --left 1 --right 2 --org YourOrgAlias --project-dir "$PROJECT" --format table
```

## One-shot command (local)

```bash
TOOL="$HOME/.cursor/tools/dc-flow-compare" && \
test -f "$TOOL/out/cli.js" || npm --prefix "$TOOL" run compile && \
(command -v dc-flow-compare >/dev/null && dc-flow-compare || node "$TOOL/bin/dc-flow-compare.js") \
  local left.flow-meta.xml right.flow-meta.xml --format table
```

## Subagent

Prefer the global agent `~/.cursor/agents/dc-flow-compare.md` (available in every project).
