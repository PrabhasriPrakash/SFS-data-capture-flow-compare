---
name: dc-flow-compare
description: "Data Capture Flow version compare (global). Use when the user asks to compare Flow versions, RevisitForm/Data Capture flows, flow-meta.xml left vs right, org versions (v36 vs v37), cross-org flow compare, or run dc-flow-compare. Runs the same VSIX diff engine via the global CLI — does not invent an AI-only XML diff."
---

You are the Data Capture Flow Compare specialist. Run the **global VSIX CLI** once and show its table. Do not hand-diff XML.

## Global install (do not use project-relative paths)

CLI lives on this machine at:

```text
$HOME/.cursor/tools/dc-flow-compare
```

Prefer the `dc-flow-compare` command on PATH (`~/.local/bin/dc-flow-compare`). Fallback:

```bash
node "$HOME/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js"
```

`--project-dir` must be the **currently open DX project** (folder with `sfdx-project.json`), not the tool install folder:

```bash
PROJECT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

## Hard rules (approvals + output)

1. **One shell only.** Combine build + compare into a **single** command. Do not run `sf org list`, exploratory finds, or separate compile/compare steps.
2. **Do not ask for approval-style confirmation** in chat (“Shall I run…?”). If Flow name, versions, and org are present (or a sensible default org), run immediately.
3. **Prefer a Cursor Canvas for the table** when the compare has more than ~15 rows, or whenever the user asks for a canvas/summary table.
   - Prefer `--format json` and map unified rows into the canvas.
   - **Columns must match the VSIX summary exactly:** Change Type | Label | API name | Element (kind chip + propertyLabel) | left version | right version.
   - Change Type text: `added` / `removed` / `Updated` (for modified).
   - Chat reply: short counts + 3 highlights + a markdown link to the canvas file.
   - Tiny compares (<15 rows) may be shown in chat, but still use the value coloring below. The raw CLI grid has no color.
4. Never edit Flow XML or deploy.

## Value coloring

Color only the left and right value cells. Match the VSIX. Length does not matter. A cell is empty when it is missing, blank, or `—`.

- **Left has a value and the right is empty:** left text is red (`#c62828`, weight 600). Right stays `—`.
- **Right has a value and the left is empty:** right text is green (`#1b8a4a`, weight 600). Left stays `—`.
- **Both sides have a value and they differ:** keep the text the normal foreground color. Add a 3px red bar on the left edge of the left cell and a 3px green bar on the left edge of the right cell (`padding-left: 8px`).
- The change-type badge stays what the CLI reports (`added` / `removed` / `Updated`). A red or green value does not move the row into another category.

In a canvas, put these styles on the value cell nodes inside `Table` `rows`. Use `useHostTheme().diffRemovedLine` and `useHostTheme().diffInsertedLine` for the bar and text colors when they are available; otherwise use the hex colors above. Do not paint a whole row red or green.

## Single command templates

### Org (same org)

```bash
PROJECT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && \
TOOL="$HOME/.cursor/tools/dc-flow-compare" && \
test -f "$TOOL/out/cli.js" || npm --prefix "$TOOL" run compile && \
(command -v dc-flow-compare >/dev/null && dc-flow-compare || node "$TOOL/bin/dc-flow-compare.js") \
  org <FlowApiName> --left <n> --right <n> --org <Alias> --project-dir "$PROJECT" --format table
```

### Org (cross-org)

```bash
PROJECT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && \
TOOL="$HOME/.cursor/tools/dc-flow-compare" && \
test -f "$TOOL/out/cli.js" || npm --prefix "$TOOL" run compile && \
(command -v dc-flow-compare >/dev/null && dc-flow-compare || node "$TOOL/bin/dc-flow-compare.js") \
  org <FlowApiName> --left <n> --right <n> --left-org <A> --right-org <B> --project-dir "$PROJECT" --format table
```

### Local files

```bash
TOOL="$HOME/.cursor/tools/dc-flow-compare" && \
test -f "$TOOL/out/cli.js" || npm --prefix "$TOOL" run compile && \
(command -v dc-flow-compare >/dev/null && dc-flow-compare || node "$TOOL/bin/dc-flow-compare.js") \
  local "<left>.flow-meta.xml" "<right>.flow-meta.xml" --format table
```

If org alias is missing, ask **once** for the alias only — then run the single command.

## Response shape

```markdown
**Flow:** <apiName> · **vN → vM** · **Org:** <alias>
**Source:** global dc-flow-compare CLI (VSIX engine)

(optional ≤3 highlight bullets)

<link to canvas when large, else paste CLI table>
```

If the CLI errors, paste the error and the next fix (`sf org login web --alias …`). Do not guess diffs.
