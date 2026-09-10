import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { exportCompareReport, tryExportPdf } from "./exportReport";
import {
  diffFlowSnapshots,
  formatDiffMarkdown,
  FlowDiffResult,
  NoiseOptions,
  parseFlowXml,
} from "./flowDiff";
import { clearFlowPickCaches, findFlowByApiName, pickFlowDefinition, pickOneVersion, pickTwoVersions } from "./flowVersions";
import { clearOrgListCache, pickTargetOrg, retrieveFlowVersions, SfCliError } from "./sfCli";
import { SummaryPanel } from "./summaryPanel";
import { FlowVerificationError, verifyFlowFile } from "./verifyFlow";
import { findElementLocation } from "./xmlLocate";
import { versionLabelFromPath } from "./versionLabel";

/** SF CLI requires --output-dir inside the project; staging is deleted after copy to OS temp. */
const STAGING_REL = path.join("tmp", "dc-flow-compare");

interface CompareSession {
  leftPath: string;
  rightPath: string;
  diff: FlowDiffResult;
  noise: NoiseOptions;
  markdown: string;
  /** OS temp folder holding this compare's XMLs (org compares only). */
  tempDir?: string;
}

interface RevealTarget {
  name: string;
  side: "left" | "right";
  kind?: string;
  previousName?: string;
  propertyPath?: string;
}

let lastSession: CompareSession | undefined;
/** Previous org-compare temp dirs to remove on next compare / deactivate. */
const tempDirsToClean: string[] = [];
let output: vscode.OutputChannel | undefined;

function logChannel(): vscode.OutputChannel {
  if (!output) {
    output = vscode.window.createOutputChannel("Data Capture Flow Compare");
  }
  return output;
}

function noiseOptions(): NoiseOptions {
  const cfg = vscode.workspace.getConfiguration("dcFlowCompare");
  return {
    ignoreLayoutNoise: cfg.get<boolean>("ignoreLayoutNoise", true),
    ignoreProcessMetadata: cfg.get<boolean>("ignoreProcessMetadata", true),
  };
}

function onlyDataCapture(): boolean {
  return vscode.workspace
    .getConfiguration("dcFlowCompare")
    .get<boolean>("onlyDataCaptureFlows", true);
}

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    throw new Error("Open a folder workspace first.");
  }
  return folder;
}

function rmDirSafe(dir: string | undefined): void {
  if (!dir) {
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function cleanTrackedTempDirs(): void {
  while (tempDirsToClean.length > 0) {
    rmDirSafe(tempDirsToClean.pop());
  }
}

function isPathUnder(filePath: string, dir: string): boolean {
  const root = path.resolve(dir);
  const target = path.resolve(filePath);
  return target === root || target.startsWith(root + path.sep);
}

/** Close tabs pointing at staging files so delete does not leave broken editor URIs. */
async function closeEditorsUnder(dir: string): Promise<void> {
  const toClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as unknown;
      if (input instanceof vscode.TabInputText) {
        if (
          input.uri.scheme === "file" &&
          isPathUnder(input.uri.fsPath, dir)
        ) {
          toClose.push(tab);
        }
      } else if (input instanceof vscode.TabInputTextDiff) {
        const uris = [input.original, input.modified];
        if (
          uris.some(
            (u) => u.scheme === "file" && isPathUnder(u.fsPath, dir)
          )
        ) {
          toClose.push(tab);
        }
      }
    }
  }
  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose, true);
  }
}

async function removeStaging(stagingDir: string): Promise<void> {
  const stagingRoot = path.join(workspaceRoot(), STAGING_REL);
  const legacyRoot = path.join(workspaceRoot(), "dc-flow-compare-staging");
  await closeEditorsUnder(stagingRoot);
  await closeEditorsUnder(legacyRoot);
  rmDirSafe(stagingDir);
  rmDirSafe(legacyRoot);
  // Remove empty parents: tmp/dc-flow-compare → tmp (if empty)
  let cursor: string | undefined = stagingRoot;
  for (let i = 0; i < 2 && cursor; i++) {
    try {
      if (fs.existsSync(cursor) && fs.readdirSync(cursor).length === 0) {
        fs.rmdirSync(cursor);
        cursor = path.dirname(cursor);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

/**
 * SF CLI cannot write outside the project, so we retrieve into a short-lived
 * workspace staging folder, copy normalized XMLs to OS temp, then delete staging.
 */
function createOrgCompareDirs(apiName: string): {
  stagingDir: string;
  tempDir: string;
} {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `dc-flow-compare-${apiName}-`)
  );
  const stagingDir = path.join(
    workspaceRoot(),
    STAGING_REL,
    path.basename(tempDir)
  );
  fs.mkdirSync(stagingDir, { recursive: true });
  return { stagingDir, tempDir };
}

function findRetrievedFlowFile(
  retrieveRoot: string,
  apiName: string,
  version: number
): string | undefined {
  const candidates = [
    path.join(
      retrieveRoot,
      "force-app",
      "main",
      "default",
      "flows",
      `${apiName}-${version}.flow-meta.xml`
    ),
    path.join(
      retrieveRoot,
      "force-app",
      "main",
      "default",
      "flows",
      `${apiName}.flow-meta.xml`
    ),
    path.join(retrieveRoot, "flows", `${apiName}-${version}.flow-meta.xml`),
    path.join(retrieveRoot, "flows", `${apiName}.flow-meta.xml`),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  const matches: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name === `${apiName}-${version}.flow-meta.xml` ||
        entry.name === `${apiName}.flow-meta.xml`
      ) {
        matches.push(full);
      }
    }
  };
  walk(retrieveRoot);
  return matches[0];
}

async function retrieveVersionIsolated(
  apiName: string,
  version: number,
  stagingBase: string,
  tempBase: string,
  options?: { targetOrg?: string; filePrefix?: string }
): Promise<string> {
  const orgKey = (options?.filePrefix || options?.targetOrg || "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 40);
  const versionDir = path.join(
    stagingBase,
    orgKey ? `${orgKey}-v${version}` : `v${version}`
  );
  fs.mkdirSync(versionDir, { recursive: true });

  const written = await retrieveFlowVersions(
    apiName,
    [version],
    versionDir,
    options?.targetOrg
  );
  const found =
    written.find((p) => p.endsWith(".flow-meta.xml") || p.endsWith(".flow")) ||
    findRetrievedFlowFile(versionDir, apiName, version);

  if (!found || !fs.existsSync(found)) {
    throw new Error(
      `Retrieved Flow:${apiName}-${version} but could not locate the XML under ${versionDir}. ` +
        `Next step: confirm the version exists in the org.`
    );
  }

  fs.mkdirSync(tempBase, { recursive: true });
  const fileName = orgKey
    ? `${orgKey}-${apiName}-v${version}.flow-meta.xml`
    : `${apiName}-v${version}.flow-meta.xml`;
  const normalized = path.join(tempBase, fileName);
  fs.copyFileSync(found, normalized);

  verifyFlowFile(normalized, {
    expectedApiName: apiName,
    expectedVersion: version,
    requireDataCapture: onlyDataCapture(),
  });

  return normalized;
}

async function openXmlDiff(
  leftPath: string,
  rightPath: string,
  jump?: {
    leftName: string;
    rightName: string;
    kind?: string;
    propertyPath?: string;
  }
): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.file(leftPath),
    vscode.Uri.file(rightPath),
    `${path.basename(leftPath)} ↔ ${path.basename(rightPath)}`
  );

  if (!jump) {
    return;
  }

  // Let the diff editors mount, then select the element on both sides.
  const leftXml = fs.readFileSync(leftPath, "utf8");
  const rightXml = fs.readFileSync(rightPath, "utf8");
  const leftLoc = findElementLocation(leftXml, jump.leftName, {
    kind: jump.kind,
    propertyPath: jump.propertyPath,
  });
  const rightLoc = findElementLocation(rightXml, jump.rightName, {
    kind: jump.kind,
    propertyPath: jump.propertyPath,
  });

  const leftResolved = path.resolve(leftPath);
  const rightResolved = path.resolve(rightPath);
  let applied = false;
  for (let attempt = 0; attempt < 6 && !applied; attempt++) {
    await delay(40 + attempt * 40);
    for (const editor of vscode.window.visibleTextEditors) {
      const fsPath = path.resolve(editor.document.uri.fsPath);
      if (fsPath === leftResolved && leftLoc.found) {
        selectAndReveal(editor, leftLoc.line);
        applied = true;
      }
      if (fsPath === rightResolved && rightLoc.found) {
        selectAndReveal(editor, rightLoc.line);
        applied = true;
      }
    }
  }

  if (!leftLoc.found && !rightLoc.found) {
    void vscode.window.showInformationMessage(
      `Could not locate "${jump.rightName || jump.leftName}" in the XML diff.`
    );
  }
}

async function revealElementInXml(target: RevealTarget & { filePath: string }): Promise<void> {
  const xml = fs.readFileSync(target.filePath, "utf8");
  const lookupName =
    target.side === "left" && target.previousName
      ? target.previousName
      : target.name;
  const loc = findElementLocation(xml, lookupName, {
    kind: target.kind,
    alternateName: target.side === "left" ? target.name : target.previousName,
    propertyPath: target.propertyPath,
  });

  if (!loc.found) {
    void vscode.window.showInformationMessage(
      `"${lookupName}" is not in this version (added, removed, or renamed).`
    );
    // Still open the file so the user can browse.
  }

  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(target.filePath)
  );
  const line = loc.found ? loc.line : 0;
  const position = new vscode.Position(line, 0);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: false,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.One,
    selection: new vscode.Range(position, position),
  });
  selectAndReveal(editor, line);
}

function selectAndReveal(editor: vscode.TextEditor, line: number): void {
  const safeLine = Math.max(0, Math.min(line, editor.document.lineCount - 1));
  const textLine = editor.document.lineAt(safeLine);
  const range = textLine.range;
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSession(
  leftPath: string,
  rightPath: string,
  tempDir?: string
): CompareSession {
  verifyFlowFile(leftPath);
  verifyFlowFile(rightPath);
  const noise = noiseOptions();
  const leftVer = versionLabelFromPath(leftPath);
  const rightVer = versionLabelFromPath(rightPath);
  const diff = diffFlowSnapshots(
    parseFlowXml(fs.readFileSync(leftPath, "utf8"), noise),
    parseFlowXml(fs.readFileSync(rightPath, "utf8"), noise)
  );
  const markdown = formatDiffMarkdown(
    diff,
    path.basename(leftPath),
    path.basename(rightPath),
    {
      ...noise,
      leftVersionLabel: leftVer,
      rightVersionLabel: rightVer,
    }
  );
  return { leftPath, rightPath, diff, noise, markdown, tempDir };
}

async function pickExportDir(): Promise<string | undefined> {
  let defaultUri: vscode.Uri;
  try {
    defaultUri = vscode.Uri.file(workspaceRoot());
  } catch {
    defaultUri = vscode.Uri.file(os.homedir());
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Export report here",
    defaultUri,
  });
  return picked?.[0]?.fsPath;
}

async function exportLastOrSession(session: CompareSession): Promise<void> {
  const outputDir = await pickExportDir();
  if (!outputDir) {
    return;
  }
  const exported = exportCompareReport({
    diff: session.diff,
    leftPath: session.leftPath,
    rightPath: session.rightPath,
    noise: session.noise,
    outputDir,
  });

  let pdfLine = "";
  if (exported.pdfPath) {
    const pdf = await tryExportPdf(exported.htmlPath, exported.pdfPath);
    if (pdf.ok) {
      pdfLine = `\n${exported.pdfPath}`;
    } else if (pdf.note) {
      pdfLine = `\n(PDF: ${pdf.note})`;
    }
  }

  const open = await vscode.window.showInformationMessage(
    `Exported:\n${exported.markdownPath}\n${exported.htmlPath}${pdfLine}`,
    "Open folder"
  );
  if (open === "Open folder") {
    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(exported.markdownPath)
    );
  }
}

async function openChangeSummary(
  leftPath: string,
  rightPath: string,
  tempDir?: string,
  labels?: { leftVersionLabel?: string; rightVersionLabel?: string }
): Promise<void> {
  const session = buildSession(leftPath, rightPath, tempDir);
  lastSession = session;

  SummaryPanel.show(
    {
      leftTitle: path.basename(leftPath),
      rightTitle: path.basename(rightPath),
      leftPath,
      rightPath,
      leftVersionLabel:
        labels?.leftVersionLabel || versionLabelFromPath(leftPath),
      rightVersionLabel:
        labels?.rightVersionLabel || versionLabelFromPath(rightPath),
      diff: session.diff,
    },
    {
      onReveal: async (target) => {
        await revealElementInXml({
          ...target,
          filePath: target.side === "left" ? leftPath : rightPath,
        });
      },
      onOpenDiff: async (target) => {
        const leftName = target.previousName || target.name;
        await openXmlDiff(leftPath, rightPath, {
          leftName,
          rightName: target.name,
          kind: target.kind,
          propertyPath: target.propertyPath,
        });
      },
      onExport: async () => {
        await exportLastOrSession(session);
      },
    }
  );
}

async function pickSecondLocalFlow(
  first: vscode.Uri
): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Compare with this flow",
    filters: { "Flow metadata": ["xml"] },
    defaultUri: vscode.Uri.file(path.dirname(first.fsPath)),
  });
  return picked?.[0];
}

function formatError(err: unknown): string {
  if (
    err instanceof SfCliError ||
    err instanceof FlowVerificationError ||
    err instanceof Error
  ) {
    return err.message;
  }
  return String(err);
}

/** Short, presentable message for toasts; full detail goes to the Output channel. */
function friendlyFailure(err: unknown): { title: string; detail: string } {
  const detail = formatError(err);
  const lower = detail.toLowerCase();
  if (
    lower.includes("not authenticated") ||
    lower.includes("no authorization") ||
    lower.includes("namedorgnotfound") ||
    lower.includes("invalid_grant") ||
    lower.includes("refresh token") ||
    lower.includes("sf org login")
  ) {
    return {
      title: "Not connected to Salesforce. Sign in with Salesforce CLI, then try again.",
      detail,
    };
  }
  if (
    lower.includes("not found on path") ||
    lower.includes("cli (`sf`) not found") ||
    lower.includes("command not found") ||
    lower.includes("enoent")
  ) {
    return {
      title: "Salesforce CLI is not available. Install Salesforce CLI and reload the window.",
      detail,
    };
  }
  if (lower.includes("open a folder") || lower.includes("workspace")) {
    return {
      title: "Open your Salesforce project folder first, then run compare.",
      detail,
    };
  }
  if (lower.includes("could not locate") || lower.includes("wrote no files")) {
    return {
      title: "Could not download those Flow versions from the org. Check the version numbers and try again.",
      detail,
    };
  }
  return {
    title: "Flow compare could not finish. See details if you need technical info.",
    detail,
  };
}

async function presentFailure(context: string, err: unknown): Promise<void> {
  const { title, detail } = friendlyFailure(err);
  const channel = logChannel();
  channel.appendLine(`[${new Date().toISOString()}] ${context}`);
  channel.appendLine(detail);
  channel.appendLine("");

  const choice = await vscode.window.showErrorMessage(
    title,
    "Show details",
    "Copy details"
  );
  if (choice === "Show details") {
    channel.show(true);
  } else if (choice === "Copy details") {
    await vscode.env.clipboard.writeText(detail);
    void vscode.window.showInformationMessage("Error details copied.");
  }
}

async function presentSuccess(
  title: string,
  changeCount: number
): Promise<void> {
  const summary =
    changeCount === 0
      ? `${title} — no functional differences`
      : `${title} — ${changeCount} change${changeCount === 1 ? "" : "s"}`;
  void vscode.window.showInformationMessage(`Flow compare ready: ${summary}`);
}

async function compareSameOrg(): Promise<void> {
  clearOrgListCache();
  clearFlowPickCaches();

  const flow = await pickFlowDefinition(onlyDataCapture());
  if (!flow) {
    return;
  }

  const pair = await pickTwoVersions(flow.Id, flow.DeveloperName);
  if (!pair) {
    return;
  }
  const [left, right] = pair;

  cleanTrackedTempDirs();
  const { stagingDir, tempDir } = createOrgCompareDirs(flow.DeveloperName);
  tempDirsToClean.push(tempDir);

  let leftPath = "";
  let rightPath = "";
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Retrieving ${flow.DeveloperName} v${left.VersionNumber} & v${right.VersionNumber}…`,
        cancellable: false,
      },
      async () => {
        leftPath = await retrieveVersionIsolated(
          flow.DeveloperName,
          left.VersionNumber,
          stagingDir,
          tempDir
        );
        rightPath = await retrieveVersionIsolated(
          flow.DeveloperName,
          right.VersionNumber,
          stagingDir,
          tempDir
        );
        await removeStaging(stagingDir);
      }
    );

    await openXmlDiff(leftPath, rightPath);
    await openChangeSummary(leftPath, rightPath, tempDir);
    await presentSuccess(
      `${flow.DeveloperName} v${left.VersionNumber} ↔ v${right.VersionNumber}`,
      lastSession?.diff.changes.length ?? 0
    );
  } catch (err) {
    await removeStaging(stagingDir);
    rmDirSafe(tempDir);
    throw err;
  }
}

async function compareAcrossOrgs(): Promise<void> {
  clearOrgListCache();
  clearFlowPickCaches();

  const leftOrg = await pickTargetOrg("Select BASELINE org");
  if (!leftOrg) {
    return;
  }
  const flow = await pickFlowDefinition(onlyDataCapture(), {
    targetOrg: leftOrg,
    placeHolder: `Select flow to compare (${leftOrg})`,
  });
  if (!flow) {
    return;
  }
  const leftVer = await pickOneVersion(flow.Id, flow.DeveloperName, leftOrg);
  if (!leftVer) {
    return;
  }

  const rightOrg = await pickTargetOrg("Select COMPARE org");
  if (!rightOrg) {
    return;
  }
  if (rightOrg === leftOrg) {
    void vscode.window.showWarningMessage(
      "Pick a different org for cross-org compare, or use Same org mode for two versions."
    );
    return;
  }

  const rightFlow = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Looking up ${flow.DeveloperName} in ${rightOrg}…`,
      cancellable: false,
    },
    () =>
      findFlowByApiName(flow.DeveloperName, onlyDataCapture(), rightOrg)
  );
  if (!rightFlow) {
    void vscode.window.showErrorMessage(
      `Flow ${flow.DeveloperName} was not found in ${rightOrg}.`
    );
    return;
  }

  const rightVer = await pickOneVersion(
    rightFlow.Id,
    rightFlow.DeveloperName,
    rightOrg
  );
  if (!rightVer) {
    return;
  }

  cleanTrackedTempDirs();
  const { stagingDir, tempDir } = createOrgCompareDirs(
    `${flow.DeveloperName}-xorg`
  );
  tempDirsToClean.push(tempDir);

  let leftPath = "";
  let rightPath = "";
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Retrieving ${flow.DeveloperName} from ${leftOrg} & ${rightOrg}…`,
        cancellable: false,
      },
      async () => {
        const [left, right] = await Promise.all([
          retrieveVersionIsolated(
            flow.DeveloperName,
            leftVer.VersionNumber,
            stagingDir,
            tempDir,
            { targetOrg: leftOrg, filePrefix: leftOrg }
          ),
          retrieveVersionIsolated(
            flow.DeveloperName,
            rightVer.VersionNumber,
            stagingDir,
            tempDir,
            { targetOrg: rightOrg, filePrefix: rightOrg }
          ),
        ]);
        leftPath = left;
        rightPath = right;
        await removeStaging(stagingDir);
      }
    );

    const leftLabel = `${leftOrg} v${leftVer.VersionNumber}`;
    const rightLabel = `${rightOrg} v${rightVer.VersionNumber}`;
    await openXmlDiff(leftPath, rightPath);
    await openChangeSummary(leftPath, rightPath, tempDir, {
      leftVersionLabel: leftLabel,
      rightVersionLabel: rightLabel,
    });
    await presentSuccess(
      `${flow.DeveloperName} (${leftLabel}) ↔ (${rightLabel})`,
      lastSession?.diff.changes.length ?? 0
    );
  } catch (err) {
    await removeStaging(stagingDir);
    rmDirSafe(tempDir);
    throw err;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(logChannel());
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dcFlowCompare.compareVersions",
      async () => {
        try {
          const mode = await vscode.window.showQuickPick(
            [
              {
                label: "$(organization) Same org",
                description: "Compare two versions of one flow",
                mode: "same" as const,
              },
              {
                label: "$(globe) Across two orgs",
                description: "Same flow API name — pick version in each org",
                mode: "cross" as const,
              },
            ],
            { placeHolder: "How do you want to compare?" }
          );
          if (!mode) {
            return;
          }
          if (mode.mode === "cross") {
            await compareAcrossOrgs();
          } else {
            await compareSameOrg();
          }
        } catch (err) {
          await presentFailure("Compare from Org", err);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dcFlowCompare.compareLocalFiles",
      async (uri?: vscode.Uri) => {
        try {
          const first =
            uri ??
            vscode.window.activeTextEditor?.document.uri ??
            (
              await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { "Flow metadata": ["xml"] },
              })
            )?.[0];

          if (!first) {
            return;
          }

          const second = await pickSecondLocalFlow(first);
          if (!second) {
            return;
          }

          verifyFlowFile(first.fsPath);
          verifyFlowFile(second.fsPath);

          await openXmlDiff(first.fsPath, second.fsPath);
          await openChangeSummary(first.fsPath, second.fsPath);
          void vscode.window.showInformationMessage(
            `Flow compare ready: ${path.basename(first.fsPath)} ↔ ${path.basename(second.fsPath)}`
          );
        } catch (err) {
          await presentFailure("Compare local files", err);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dcFlowCompare.changeSummary",
      async (uri?: vscode.Uri) => {
        try {
          const first =
            uri ??
            vscode.window.activeTextEditor?.document.uri ??
            (
              await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { "Flow metadata": ["xml"] },
              })
            )?.[0];
          if (!first) {
            return;
          }

          const second = await pickSecondLocalFlow(first);
          if (!second) {
            return;
          }

          await openChangeSummary(first.fsPath, second.fsPath);
          void vscode.window.showInformationMessage("Change summary ready.");
        } catch (err) {
          await presentFailure("Change summary", err);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dcFlowCompare.exportReport", async () => {
      if (!lastSession) {
        void vscode.window.showWarningMessage(
          "No compare summary yet. Run a compare first."
        );
        return;
      }
      await exportLastOrSession(lastSession);
    })
  );
}

export function deactivate(): void {
  cleanTrackedTempDirs();
}
