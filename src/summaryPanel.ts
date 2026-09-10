import * as vscode from "vscode";
import { ElementChange, FlowDiffResult } from "./flowDiff";
import {
  buildUnifiedRows,
  countUnifiedRows,
  isConnectorProperty,
  isShortValue,
  valueCellClass,
} from "./unifiedTable";

export interface SummaryPanelPayload {
  leftTitle: string;
  rightTitle: string;
  leftPath: string;
  rightPath: string;
  /** Short labels for property table headers, e.g. v34 / v35 */
  leftVersionLabel: string;
  rightVersionLabel: string;
  diff: FlowDiffResult;
}

type FilterKey = "all" | "added" | "removed" | "modified";

interface SelectedChange {
  name: string;
  kind: string;
  previousName?: string;
  propertyPath?: string;
}

export class SummaryPanel {
  public static current: SummaryPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private payload: SummaryPanelPayload;
  private selected: SelectedChange | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    payload: SummaryPanelPayload,
    private readonly onReveal: (target: {
      name: string;
      side: "left" | "right";
      kind?: string;
      previousName?: string;
      propertyPath?: string;
    }) => Promise<void>,
    private readonly onOpenDiff: (target: {
      name: string;
      kind?: string;
      previousName?: string;
      propertyPath?: string;
    }) => Promise<void>,
    private readonly onExport: () => Promise<void>
  ) {
    this.panel = panel;
    this.payload = payload;
    this.selected = this.selectionFromChange(payload.diff.changes[0]);
    this.panel.webview.html = this.renderHtml();
    this.panel.onDidDispose(() => {
      if (SummaryPanel.current === this) {
        SummaryPanel.current = undefined;
      }
    });
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") {
        return;
      }
      if (msg.type === "select") {
        this.selected = {
          name: String(msg.name ?? ""),
          kind: String(msg.kind ?? ""),
          previousName: msg.previousName
            ? String(msg.previousName)
            : undefined,
          propertyPath: msg.propertyPath
            ? String(msg.propertyPath)
            : undefined,
        };
      } else if (msg.type === "reveal") {
        const name = String(msg.name || this.selected?.name || "");
        if (!name) {
          void vscode.window.showInformationMessage(
            "Select a row first, then use Baseline XML / Compare XML."
          );
          return;
        }
        await this.onReveal({
          name,
          side: msg.side === "left" ? "left" : "right",
          kind: String(msg.kind || this.selected?.kind || ""),
          previousName:
            (msg.previousName
              ? String(msg.previousName)
              : this.selected?.previousName) || undefined,
          propertyPath:
            (msg.propertyPath
              ? String(msg.propertyPath)
              : this.selected?.propertyPath) || undefined,
        });
      } else if (msg.type === "export") {
        await this.onExport();
      } else if (msg.type === "openDiff") {
        const name = String(msg.name || this.selected?.name || "");
        await this.onOpenDiff({
          name,
          kind: String(msg.kind || this.selected?.kind || ""),
          previousName:
            (msg.previousName
              ? String(msg.previousName)
              : this.selected?.previousName) || undefined,
          propertyPath:
            (msg.propertyPath
              ? String(msg.propertyPath)
              : this.selected?.propertyPath) || undefined,
        });
      }
    });
  }

  private selectionFromChange(
    change: ElementChange | undefined
  ): SelectedChange | undefined {
    if (!change) {
      return undefined;
    }
    return {
      name: change.name,
      kind: change.kind,
      previousName: change.previousName,
      propertyPath: change.properties[0]?.path,
    };
  }

  static show(
    payload: SummaryPanelPayload,
    handlers: {
      onReveal: (target: {
        name: string;
        side: "left" | "right";
        kind?: string;
        previousName?: string;
        propertyPath?: string;
      }) => Promise<void>;
      onOpenDiff: (target: {
        name: string;
        kind?: string;
        previousName?: string;
        propertyPath?: string;
      }) => Promise<void>;
      onExport: () => Promise<void>;
    }
  ): SummaryPanel {
    if (SummaryPanel.current) {
      SummaryPanel.current.payload = payload;
      SummaryPanel.current.selected = SummaryPanel.current.selectionFromChange(
        payload.diff.changes[0]
      );
      SummaryPanel.current.panel.title = `Flow compare: ${payload.leftTitle} ↔ ${payload.rightTitle}`;
      SummaryPanel.current.panel.webview.html =
        SummaryPanel.current.renderHtml();
      SummaryPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return SummaryPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      "dcFlowCompare.summary",
      `Flow compare: ${payload.leftTitle} ↔ ${payload.rightTitle}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    SummaryPanel.current = new SummaryPanel(
      panel,
      payload,
      handlers.onReveal,
      handlers.onOpenDiff,
      handlers.onExport
    );
    return SummaryPanel.current;
  }

  private renderHtml(): string {
    const { diff, leftTitle, rightTitle, leftVersionLabel, rightVersionLabel } =
      this.payload;
    const rows = buildUnifiedRows(diff);
    const counts = countUnifiedRows(rows);
    const tableRows = rows
      .map((r) => {
        const leftCls = valueCellClass("left", r.left, r.right);
        const rightCls = valueCellClass("right", r.left, r.right);
        const leftShort = isShortValue(r.left) ? " short" : "";
        const rightShort = isShortValue(r.right) ? " short" : "";
        const selected =
          this.selected?.name === r.name &&
          (this.selected.propertyPath || "") === (r.propertyPath || "")
            ? " selected"
            : "";
        const elementBlock = isConnectorProperty(r.propertyPath)
          ? `<span class="kind-chip">connector</span>`
          : `<span class="kind-chip">${esc(r.kind)}</span>${
              r.propertyPath
                ? `<div class="el-prop-label">${esc(r.propertyLabel || r.propertyPath)}</div>`
                : ""
            }`;
        return `<tr class="urow ${r.change}${selected}" data-change="${r.change}" data-select="${esc(r.name)}" data-kind="${esc(r.kind)}" data-previous="${esc(r.previousName || "")}" data-prop="${esc(r.propertyPath || "")}" data-search="${esc(r.search)}" role="button" tabindex="0">
  <td class="col-action"><span class="badge ${r.change}">${r.change === "modified" ? "Updated" : r.change}</span></td>
  <td class="col-label">${r.label ? esc(r.label) : `<span class="muted">—</span>`}</td>
  <td class="col-api"><span class="api-name">${esc(r.element)}</span></td>
  <td class="col-element">${elementBlock}</td>
  <td class="col-val col-left ${leftCls}${leftShort}">${esc(r.left)}</td>
  <td class="col-val col-right ${rightCls}${rightShort}">${esc(r.right)}</td>
</tr>`;
      })
      .join("\n");

    const filterButtons = (
      [
        ["all", "All", counts.all],
        ["added", "Added", counts.added],
        ["removed", "Removed", counts.removed],
        ["modified", "Updated", counts.modified],
      ] as Array<[FilterKey, string, number]>
    )
      .map(
        ([f, label, count]) =>
          `<button class="chip chip-${f}${f === "all" ? " active" : ""}" data-filter="${f}"><span class="chip-dot"></span>${label} <em>${count}</em></button>`
      )
      .join("");

    const selectedLabel = this.selected?.name
      ? `<code id="selectedName">${esc(this.selected.name)}</code>`
      : `<span class="muted" id="selectedName">click a row</span>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"/>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border, rgba(127,127,127,.35));
    --btn: var(--vscode-button-background);
    --btnFg: var(--vscode-button-foreground);
    --input: var(--vscode-input-background);
    --inputFg: var(--vscode-input-foreground);
    --inputBorder: var(--vscode-input-border, rgba(127,127,127,.45));
    --focus: var(--vscode-focusBorder, #3794ff);
    --added: #1b8a4a;
    --added-bg: color-mix(in srgb, #1b8a4a 14%, transparent);
    --added-soft: color-mix(in srgb, #1b8a4a 22%, transparent);
    --removed: #d32f2f;
    --removed-bg: color-mix(in srgb, #d32f2f 14%, transparent);
    --removed-soft: color-mix(in srgb, #d32f2f 22%, transparent);
    --modified: #c9a000;
    --modified-bg: color-mix(in srgb, #f4d03f 18%, transparent);
    --modified-soft: color-mix(in srgb, #f1c40f 28%, transparent);
    --all: #1565c0;
    --all-bg: color-mix(in srgb, #1565c0 14%, transparent);
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--fg);
    background:
      radial-gradient(1200px 400px at 0% -10%, color-mix(in srgb, #1565c0 10%, transparent), transparent 60%),
      radial-gradient(900px 360px at 100% 0%, color-mix(in srgb, #f1c40f 10%, transparent), transparent 55%),
      var(--bg);
    margin: 0;
    padding: 18px 18px 48px;
  }
  h1 { font-size: 18px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .hero {
    display: grid; gap: 10px; margin-bottom: 14px; padding: 14px 16px;
    border: 1px solid var(--border); border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 3%, transparent);
  }
  .meta { color: var(--muted); font-size: 12px; line-height: 1.5; }
  .meta code {
    color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent);
    padding: 1px 6px; border-radius: 4px;
  }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; }
  .stat {
    display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
    padding: 4px 10px; font-size: 12px; font-weight: 600; border: 1px solid transparent;
  }
  .stat em { font-style: normal; opacity: .85; font-weight: 700; }
  .stat-all { color: var(--all); background: var(--all-bg); border-color: color-mix(in srgb, var(--all) 35%, transparent); }
  .stat-added { color: var(--added); background: var(--added-bg); border-color: color-mix(in srgb, var(--added) 35%, transparent); }
  .stat-removed { color: var(--removed); background: var(--removed-bg); border-color: color-mix(in srgb, var(--removed) 35%, transparent); }
  .stat-modified { color: var(--modified); background: var(--modified-bg); border-color: color-mix(in srgb, var(--modified) 45%, transparent); }
  .xml-bar {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px;
    border-radius: 10px; border: 1px solid var(--border);
    background: color-mix(in srgb, var(--all) 8%, transparent); margin-bottom: 12px;
  }
  .xml-bar .selected-label { font-size: 12px; color: var(--muted); margin-right: auto; }
  .xml-bar .selected-label code { color: var(--fg); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
    border: 1px solid var(--border); background: color-mix(in srgb, var(--fg) 4%, transparent);
    color: var(--fg); padding: 5px 11px; cursor: pointer; font-size: 12px;
  }
  .chip em { font-style: normal; opacity: .75; }
  .chip-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .chip-all .chip-dot { background: var(--all); }
  .chip-added .chip-dot { background: var(--added); }
  .chip-removed .chip-dot { background: var(--removed); }
  .chip-modified .chip-dot { background: var(--modified); }
  .chip-all.active { background: var(--all-bg); border-color: color-mix(in srgb, var(--all) 55%, transparent); color: var(--all); }
  .chip-added.active { background: var(--added-bg); border-color: color-mix(in srgb, var(--added) 55%, transparent); color: var(--added); }
  .chip-removed.active { background: var(--removed-bg); border-color: color-mix(in srgb, var(--removed) 55%, transparent); color: var(--removed); }
  .chip-modified.active { background: var(--modified-bg); border-color: color-mix(in srgb, var(--modified) 55%, transparent); color: var(--modified); }
  input[type="search"] {
    flex: 1; min-width: 180px; background: var(--input); color: var(--inputFg);
    border: 1px solid var(--inputBorder); border-radius: 8px; padding: 7px 10px;
  }
  input[type="search"]:focus { outline: 1px solid var(--focus); }
  .btn-primary {
    background: var(--btn); color: var(--btnFg); border: none; border-radius: 8px;
    padding: 6px 12px; cursor: pointer; font-weight: 600;
  }
  .btn-secondary {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    color: var(--fg); border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 12px; cursor: pointer;
  }
  #list { overflow-x: auto; }
  .utable {
    width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12.5px;
    border: 1px solid color-mix(in srgb, var(--fg) 22%, var(--border));
    border-radius: 10px; overflow: hidden;
    background: color-mix(in srgb, var(--fg) 2%, var(--bg));
  }
  .utable th, .utable td {
    border-right: 1px solid color-mix(in srgb, var(--fg) 16%, var(--border));
    border-bottom: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
    vertical-align: top; text-align: left;
  }
  .utable th:last-child, .utable td:last-child { border-right: none; }
  .utable tbody tr:last-child td { border-bottom: none; }
  .utable th {
    padding: 10px 12px;
    background: color-mix(in srgb, var(--fg) 9%, var(--bg));
    color: var(--fg); font-weight: 700; font-size: 11px; text-transform: uppercase;
    letter-spacing: .04em;
  }
  .utable th.th-left,
  .utable th.th-right {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 9%, var(--bg));
  }
  .utable td { padding: 11px 12px; }
  .utable tr.urow { cursor: pointer; }
  .utable tbody tr.urow:nth-child(even) {
    background: color-mix(in srgb, var(--fg) 4.5%, transparent);
  }
  .utable tbody tr.urow:nth-child(odd) {
    background: color-mix(in srgb, var(--fg) 1%, transparent);
  }
  .utable tr.urow:hover {
    background: color-mix(in srgb, var(--focus) 12%, transparent) !important;
  }
  .utable tr.urow.selected {
    outline: 2px solid var(--focus); outline-offset: -2px;
    background: color-mix(in srgb, var(--focus) 14%, transparent) !important;
  }
  .utable tr.urow.added td.col-action {
    box-shadow: inset 3px 0 0 var(--added);
  }
  .utable tr.urow.removed td.col-action {
    box-shadow: inset 3px 0 0 var(--removed);
  }
  .utable tr.urow.modified td.col-action {
    box-shadow: inset 3px 0 0 var(--modified);
  }
  .col-action {
    width: 1%;
    white-space: nowrap;
    background: color-mix(in srgb, var(--fg) 2%, transparent);
  }
  .col-element {
    width: 16%;
    max-width: 0;
    overflow: hidden;
  }
  .col-label {
    width: 16%;
    max-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .col-api {
    width: 16%;
    max-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .col-val {
    width: 22%;
    max-width: 0;
    overflow: hidden;
    white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
    font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 12px; line-height: 1.45;
  }
  .col-val.col-left,
  .col-val.col-right {
    background: transparent;
  }
  /* Color only what matters: short values tint text; long JSON gets a thin edge, not a wash */
  .val-add.short { color: color-mix(in srgb, var(--added) 80%, var(--fg)); font-weight: 600; }
  .val-rem.short { color: color-mix(in srgb, var(--removed) 80%, var(--fg)); font-weight: 600; }
  .val-add:not(.short) {
    border-left: 3px solid color-mix(in srgb, var(--added) 75%, transparent);
    padding-left: 8px;
  }
  .val-rem:not(.short) {
    border-left: 3px solid color-mix(in srgb, var(--removed) 75%, transparent);
    padding-left: 8px;
  }
  .badge {
    text-transform: uppercase; font-size: 10px; letter-spacing: .06em; font-weight: 700;
    border-radius: 999px; padding: 3px 8px; border: 1px solid transparent;
  }
  .badge.added { color: var(--added); background: var(--added-soft); border-color: color-mix(in srgb, var(--added) 40%, transparent); }
  .badge.removed { color: var(--removed); background: var(--removed-soft); border-color: color-mix(in srgb, var(--removed) 40%, transparent); }
  .badge.modified { color: #7a6500; background: var(--modified-soft); border-color: color-mix(in srgb, var(--modified) 50%, transparent); }
  .kind-chip {
    font-size: 11px; color: var(--all); background: var(--all-bg);
    border: 1px solid color-mix(in srgb, var(--all) 30%, transparent);
    border-radius: 6px; padding: 2px 7px;
  }
  .col-api,
  .col-api .api-name {
    background: transparent !important;
  }
  .api-name {
    font-size: 12px;
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    background: transparent !important;
    color: inherit;
    padding: 0;
    border-radius: 0;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .el-prop-label {
    margin-top: 4px; font-size: 12px; line-height: 1.35;
    overflow-wrap: anywhere; word-break: break-word;
  }
  .el-prop {
    margin-top: 2px; color: var(--muted); max-width: 100%;
    overflow-wrap: anywhere; word-break: break-all;
  }
  .el-prop code {
    display: block; max-width: 100%; font-size: 11px;
    white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all;
  }
  .muted { color: var(--muted); font-size: 12px; }
  .warn {
    margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: var(--modified-bg);
    border: 1px solid color-mix(in srgb, var(--modified) 40%, transparent);
    color: color-mix(in srgb, var(--modified) 75%, var(--fg)); font-size: 12px;
  }
</style>
</head>
<body>
  <div class="hero">
    <h1>Flow compare summary</h1>
    <div class="meta">
      Baseline: <code>${esc(leftTitle)}</code><br/>
      Compare: <code>${esc(rightTitle)}</code>
      ${diff.processTypeChanged ? `<div class="warn">Process type changed: ${esc(String(diff.left.processType))} → ${esc(String(diff.right.processType))}</div>` : ""}
    </div>
    <div class="stats">
      <span class="stat stat-all">All <em>${counts.all}</em></span>
      <span class="stat stat-added">Added <em>${counts.added}</em></span>
      <span class="stat stat-removed">Removed <em>${counts.removed}</em></span>
      <span class="stat stat-modified">Updated <em>${counts.modified}</em></span>
    </div>
  </div>
  <div class="xml-bar">
    <div class="selected-label">Selected: ${selectedLabel}</div>
    <button class="btn-secondary" id="revealLeft">Baseline XML</button>
    <button class="btn-secondary" id="revealRight">Compare XML</button>
    <button class="btn-primary" id="openDiff">Open XML diff</button>
    <button class="btn-secondary" id="export">Export report</button>
  </div>
  <div class="toolbar">
    <div class="filters">${filterButtons}</div>
    <input type="search" id="search" placeholder="Search API name, field, property…" autocomplete="off"/>
  </div>
  <div id="list">
    ${
      rows.length
        ? `<table class="utable">
  <thead>
    <tr>
      <th>Change Type</th>
      <th>Label</th>
      <th>API name</th>
      <th>Element</th>
      <th class="th-left">${esc(leftVersionLabel)}</th>
      <th class="th-right">${esc(rightVersionLabel)}</th>
    </tr>
  </thead>
  <tbody>
${tableRows}
  </tbody>
</table>`
        : `<p class="muted">No changes found.</p>`
    }
    <p class="muted" id="emptyMsg" hidden>No changes match this filter/search.</p>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    let activeFilter = 'all';
    const search = document.getElementById('search');
    const emptyMsg = document.getElementById('emptyMsg');
    const selectedEl = document.getElementById('selectedName');
    const rows = () => Array.from(document.querySelectorAll('tr.urow[data-select]'));

    function applyView() {
      const q = (search.value || '').trim().toLowerCase();
      let visible = 0;
      rows().forEach((row) => {
        const changeOk = activeFilter === 'all' || row.dataset.change === activeFilter;
        const searchOk = !q || (row.dataset.search || '').includes(q);
        const show = changeOk && searchOk;
        row.hidden = !show;
        if (show) visible += 1;
      });
      if (emptyMsg) emptyMsg.hidden = visible > 0;
    }

    document.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter || 'all';
        document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === btn));
        applyView();
      });
    });

    search.addEventListener('input', () => applyView());

    function selectedRow() {
      return document.querySelector('tr.urow.selected');
    }

    document.getElementById('openDiff').addEventListener('click', () => {
      const row = selectedRow();
      vscode.postMessage({
        type: 'openDiff',
        name: row?.dataset.select || '',
        kind: row?.dataset.kind || '',
        previousName: row?.dataset.previous || '',
        propertyPath: row?.dataset.prop || ''
      });
    });
    document.getElementById('export').addEventListener('click', () => vscode.postMessage({ type: 'export' }));
    document.getElementById('revealLeft').addEventListener('click', () => {
      const row = selectedRow();
      vscode.postMessage({
        type: 'reveal',
        side: 'left',
        name: row?.dataset.select || '',
        kind: row?.dataset.kind || '',
        previousName: row?.dataset.previous || '',
        propertyPath: row?.dataset.prop || ''
      });
    });
    document.getElementById('revealRight').addEventListener('click', () => {
      const row = selectedRow();
      vscode.postMessage({
        type: 'reveal',
        side: 'right',
        name: row?.dataset.select || '',
        kind: row?.dataset.kind || '',
        previousName: row?.dataset.previous || '',
        propertyPath: row?.dataset.prop || ''
      });
    });

    rows().forEach((row) => {
      row.addEventListener('click', () => {
        rows().forEach((r) => r.classList.remove('selected'));
        row.classList.add('selected');
        const name = row.dataset.select || '';
        if (selectedEl) {
          selectedEl.textContent = name;
          selectedEl.className = '';
        }
        vscode.postMessage({
          type: 'select',
          name,
          kind: row.dataset.kind || '',
          previousName: row.dataset.previous || '',
          propertyPath: row.dataset.prop || ''
        });
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.click();
        }
      });
    });
  </script>
</body>
</html>`;
  }
}

function esc(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
