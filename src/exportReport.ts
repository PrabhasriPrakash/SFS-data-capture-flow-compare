import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import {
  FlowDiffResult,
  formatDiffMarkdown,
  NoiseOptions,
} from "./flowDiff";
import {
  buildUnifiedRows,
  countUnifiedRows,
  isConnectorProperty,
  isShortValue,
  valueCellClass,
} from "./unifiedTable";
import { versionLabelFromPath } from "./versionLabel";

const execFileAsync = promisify(execFile);

export function exportCompareReport(options: {
  diff: FlowDiffResult;
  leftPath: string;
  rightPath: string;
  noise: NoiseOptions;
  outputDir?: string;
}): {
  markdownPath: string;
  htmlPath: string;
  pdfPath?: string;
  pdfNote?: string;
} {
  const dir = options.outputDir || path.dirname(options.leftPath);
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `flow-compare-${stamp}`;
  const markdownPath = path.join(dir, `${base}.md`);
  const htmlPath = path.join(dir, `${base}.html`);
  const pdfPath = path.join(dir, `${base}.pdf`);

  const leftVer = versionLabelFromPath(options.leftPath);
  const rightVer = versionLabelFromPath(options.rightPath);

  const md = formatDiffMarkdown(
    options.diff,
    path.basename(options.leftPath),
    path.basename(options.rightPath),
    {
      ...options.noise,
      leftVersionLabel: leftVer,
      rightVersionLabel: rightVer,
    }
  );
  fs.writeFileSync(markdownPath, md, "utf8");

  const html = buildHtmlReport(
    options.diff,
    path.basename(options.leftPath),
    path.basename(options.rightPath),
    leftVer,
    rightVer
  );
  fs.writeFileSync(htmlPath, html, "utf8");

  return { markdownPath, htmlPath, pdfPath };
}

/** Try Chrome/Edge headless print-to-pdf; returns note if PDF was not created. */
export async function tryExportPdf(
  htmlPath: string,
  pdfPath: string
): Promise<{ ok: boolean; note?: string }> {
  const browsers = chromeCandidates();
  for (const bin of browsers) {
    try {
      await execFileAsync(
        bin,
        [
          "--headless",
          "--disable-gpu",
          "--no-pdf-header-footer",
          `--print-to-pdf=${pdfPath}`,
          htmlPath.startsWith("file:") ? htmlPath : `file://${htmlPath}`,
        ],
        { timeout: 60000 }
      );
      if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) {
        return { ok: true };
      }
    } catch {
      // try next browser
    }
  }
  return {
    ok: false,
    note: "PDF auto-export unavailable. Open the HTML and use Print → Save as PDF.",
  };
}

function chromeCandidates(): string[] {
  const platform = os.platform();
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "google-chrome",
      "chromium",
    ];
  }
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const pf = process.env["ProgramFiles"] || "C:\\\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\\\Program Files (x86)";
    return [
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      "chrome",
      "msedge",
    ];
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlReport(
  diff: FlowDiffResult,
  leftTitle: string,
  rightTitle: string,
  leftVer: string,
  rightVer: string
): string {
  const rows = buildUnifiedRows(diff);
  const counts = countUnifiedRows(rows);
  const bodyRows = rows
    .map((r) => {
      const leftCls = valueCellClass("left", r.left, r.right);
      const rightCls = valueCellClass("right", r.left, r.right);
      const leftShort = isShortValue(r.left) ? " short" : "";
      const rightShort = isShortValue(r.right) ? " short" : "";
      return `<tr class="${r.change}">
  <td class="action"><span class="badge ${r.change}">${r.change === "modified" ? "Updated" : r.change}</span></td>
  <td class="label-col">${r.label ? esc(r.label) : "—"}</td>
  <td class="api">${esc(r.element)}</td>
  <td class="element">${
    isConnectorProperty(r.propertyPath)
      ? `<span class="kind">connector</span>`
      : `<span class="kind">${esc(r.kind)}</span>${
          r.propertyPath
            ? `<div class="prop-label">${esc(r.propertyLabel || r.propertyPath)}</div>`
            : ""
        }`
  }</td>
  <td class="val col-left ${leftCls}${leftShort}">${esc(r.left)}</td>
  <td class="val col-right ${rightCls}${rightShort}">${esc(r.right)}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Flow compare — ${esc(leftTitle)} vs ${esc(rightTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 1.5rem; color: #1b1b1b; font-size: 12px; }
  h1 { font-size: 1.25rem; margin: 0 0 .4rem; }
  .meta { color: #555; margin-bottom: 1rem; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; border: 1px solid #c8c8c8; }
  th, td { border: 1px solid #d0d0d0; padding: 7px 8px; vertical-align: top; text-align: left; }
  th { background: #ececec; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }
  th.th-left, th.th-right { background: #ececec; color: inherit; }
  tbody tr:nth-child(even) { background: #f7f7f7; }
  tbody tr:nth-child(odd) { background: #fff; }
  .action { width: 1%; white-space: nowrap; }
  .element { width: 14%; max-width: 0; overflow: hidden; }
  .label-col {
    width: 14%; max-width: 0; overflow: hidden;
    overflow-wrap: anywhere; word-break: break-word;
  }
  .api {
    width: 14%; max-width: 0; overflow: hidden;
    overflow-wrap: anywhere; word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 600;
  }
  .val {
    width: 22%; max-width: 0; overflow: hidden;
    white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; line-height: 1.4;
  }
  .val.col-left, .val.col-right { background: transparent; }
  .badge {
    display: inline-block; text-transform: uppercase; font-size: 9px; font-weight: 700;
    letter-spacing: .04em; padding: 2px 6px; border-radius: 999px; border: 1px solid transparent;
  }
  .badge.added { color: #1b8a4a; background: #e8f5e9; border-color: #a5d6a7; }
  .badge.removed { color: #c62828; background: #ffebee; border-color: #ef9a9a; }
  .badge.modified { color: #7a6500; background: #fff8e1; border-color: #ffe082; }
  .kind {
    display: inline-block; font-size: 9px; color: #1565c0; background: #e3f2fd;
    border: 1px solid #90caf9; border-radius: 4px; padding: 1px 5px; margin-right: 4px;
  }
  .prop-label {
    margin-top: 3px; font-size: 10.5px; line-height: 1.35;
    overflow-wrap: anywhere; word-break: break-word;
  }
  .prop {
    color: #666; margin-top: 2px; font-size: 10px;
    overflow-wrap: anywhere; word-break: break-all; max-width: 100%;
  }
  .prop code {
    display: block; max-width: 100%;
    white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all;
  }
  /* Color only what matters — no full-cell wash on long JSON */
  .val-add.short { color: #1b8a4a; font-weight: 600; }
  .val-rem.short { color: #c62828; font-weight: 600; }
  .val-add:not(.short) { border-left: 3px solid #1b8a4a; padding-left: 6px; }
  .val-rem:not(.short) { border-left: 3px solid #c62828; padding-left: 6px; }
  @media print {
    body { margin: 0; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>Flow compare</h1>
  <p class="meta">
    <strong>${esc(leftVer)}:</strong> <code>${esc(leftTitle)}</code><br/>
    <strong>${esc(rightVer)}:</strong> <code>${esc(rightTitle)}</code><br/>
    ${counts.all} change(s) · ${counts.added} added · ${counts.removed} removed · ${counts.modified} updated
  </p>
  <table>
    <thead>
      <tr>
        <th>Change Type</th>
        <th>Label</th>
        <th>API name</th>
        <th>Element</th>
        <th class="th-left">${esc(leftVer)}</th>
        <th class="th-right">${esc(rightVer)}</th>
      </tr>
    </thead>
    <tbody>
${bodyRows || `<tr><td colspan="6"><em>No changes</em></td></tr>`}
    </tbody>
  </table>
</body>
</html>`;
}
