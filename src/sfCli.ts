import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { parseSfJson } from "./sfJson";

const execFileAsync = promisify(execFile);

export class SfCliError extends Error {
  constructor(
    message: string,
    readonly stderr?: string
  ) {
    super(message);
    this.name = "SfCliError";
  }
}

export { parseSfJson };

export interface SfOrgSummary {
  alias: string;
  username: string;
  isDefault: boolean;
  label: string;
}

function configuredDefaultOrg(): string {
  return (
    vscode.workspace
      .getConfiguration("dcFlowCompare")
      .get<string>("targetOrg", "")
      ?.trim() || ""
  );
}

/** Resolve --target-org flags. Empty override uses settings / CLI default. */
export function getTargetOrgFlag(targetOrg?: string): string[] {
  const alias = (targetOrg ?? configuredDefaultOrg()).trim();
  return alias ? ["--target-org", alias] : [];
}

function getCwd(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    throw new SfCliError(
      "Open a Salesforce project folder in the workspace first."
    );
  }
  return folder;
}

function parseSfJsonOrThrow<T>(stdout: string): T {
  try {
    return parseSfJson<T>(stdout);
  } catch (err) {
    throw new SfCliError(err instanceof Error ? err.message : String(err));
  }
}

function enhanceCliError(detail: string): string {
  const lower = detail.toLowerCase();
  if (
    lower.includes("nofault") ||
    lower.includes("not authenticated") ||
    lower.includes("no authorization") ||
    lower.includes("namedorgnotfound") ||
    lower.includes("enotfound") ||
    lower.includes("invalid_grant") ||
    lower.includes("refresh token")
  ) {
    return `${detail}\n\nNext step: run \`sf org login web\` (or set dcFlowCompare.targetOrg to a valid alias).`;
  }
  if (lower.includes("command not found") || lower.includes("enoent")) {
    return `${detail}\n\nNext step: install Salesforce CLI and ensure \`sf\` is on PATH, then reload the window.`;
  }
  if (
    lower.includes("outputdiroutsideproject") ||
    lower.includes("outside the project")
  ) {
    return `${detail}\n\nNext step: keep a Salesforce project folder open — retrieve staging must be inside the project (temp copies are used for compare).`;
  }
  return detail;
}

async function runSf(
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<string> {
  const cwd = options?.cwd ?? getCwd();
  try {
    const { stdout, stderr } = await execFileAsync("sf", args, {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
      timeout: options?.timeoutMs ?? 120_000,
      env: process.env,
    });
    if (stderr && /Error|ERROR/.test(stderr) && !stdout) {
      throw new SfCliError(enhanceCliError(stderr.trim()), stderr);
    }
    return stdout;
  } catch (err: unknown) {
    if (err instanceof SfCliError) {
      throw err;
    }
    const e = err as {
      message?: string;
      stderr?: string;
      stdout?: string;
      code?: string | number;
    };
    if (e.code === "ENOENT") {
      throw new SfCliError(
        "Salesforce CLI (`sf`) not found on PATH. Install it and reload the window."
      );
    }
    if (e.stdout) {
      try {
        const parsed = parseSfJsonOrThrow<{ message?: string; name?: string }>(
          e.stdout
        );
        if (parsed.message) {
          throw new SfCliError(enhanceCliError(parsed.message), e.stderr);
        }
      } catch (inner) {
        if (inner instanceof SfCliError) {
          throw inner;
        }
      }
    }
    const detail = (e.stderr || e.stdout || e.message || String(err)).trim();
    throw new SfCliError(enhanceCliError(detail), e.stderr);
  }
}

type OrgListRow = {
  alias?: string;
  username?: string;
  isDefaultUsername?: boolean;
  isDefaultDevHubUsername?: boolean;
  connectedStatus?: string;
};

function flattenOrgList(result: unknown): OrgListRow[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const r = result as Record<string, unknown>;
  const buckets = [
    "nonScratchOrgs",
    "sandboxes",
    "scratchOrgs",
    "devHubs",
    "other",
  ];
  const rows: OrgListRow[] = [];
  for (const key of buckets) {
    const arr = r[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === "object") {
          rows.push(item as OrgListRow);
        }
      }
    }
  }
  return rows;
}

let orgListCache: SfOrgSummary[] | undefined;

export function clearOrgListCache(): void {
  orgListCache = undefined;
}

export async function listAuthenticatedOrgs(
  forceRefresh = false
): Promise<SfOrgSummary[]> {
  if (!forceRefresh && orgListCache) {
    return orgListCache;
  }
  const stdout = await runSf(["org", "list", "--json"]);
  const parsed = parseSfJsonOrThrow<{
    status: number;
    result?: unknown;
    message?: string;
  }>(stdout);
  if (parsed.status !== 0) {
    throw new SfCliError(
      enhanceCliError(parsed.message || "Failed to list orgs.")
    );
  }

  const seen = new Set<string>();
  const orgs: SfOrgSummary[] = [];
  for (const row of flattenOrgList(parsed.result)) {
    const alias = (row.alias || "").trim();
    const username = (row.username || "").trim();
    const key = alias || username;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const isDefault = Boolean(row.isDefaultUsername);
    orgs.push({
      alias: alias || username,
      username,
      isDefault,
      label: alias
        ? `${alias}${isDefault ? " (default)" : ""}`
        : `${username}${isDefault ? " (default)" : ""}`,
    });
  }

  orgs.sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
  orgListCache = orgs;
  return orgs;
}

export async function pickTargetOrg(
  placeHolder: string
): Promise<string | undefined> {
  const orgs = orgListCache
    ? await listAuthenticatedOrgs()
    : await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Loading orgs…",
          cancellable: false,
        },
        () => listAuthenticatedOrgs()
      );
  if (orgs.length === 0) {
    void vscode.window.showWarningMessage(
      "No authenticated Salesforce orgs found. Run `sf org login web` first."
    );
    return undefined;
  }

  const configured = configuredDefaultOrg();
  const picked = await vscode.window.showQuickPick(
    orgs.map((o) => ({
      label: o.label,
      description: o.username && o.username !== o.alias ? o.username : undefined,
      detail:
        o.alias === configured ? "Matches dcFlowCompare.targetOrg" : undefined,
      org: o,
    })),
    { placeHolder, matchOnDescription: true }
  );
  return picked?.org.alias;
}

export async function queryToolingJson<T>(
  soql: string,
  targetOrg?: string
): Promise<T[]> {
  const args = [
    "data",
    "query",
    "--query",
    soql,
    "--use-tooling-api",
    "--json",
    ...getTargetOrgFlag(targetOrg),
  ];
  const stdout = await runSf(args);
  const parsed = parseSfJsonOrThrow<{
    status: number;
    result?: { records?: T[] };
    message?: string;
  }>(stdout);
  if (parsed.status !== 0) {
    throw new SfCliError(
      enhanceCliError(parsed.message || "Tooling query failed.")
    );
  }
  return parsed.result?.records ?? [];
}

export async function retrieveFlowVersions(
  apiName: string,
  versions: number[],
  outputDir: string,
  targetOrg?: string
): Promise<string[]> {
  const metadataFlags = versions.flatMap((v) => [
    "--metadata",
    `Flow:${apiName}-${v}`,
  ]);

  const retrieveArgs = [
    "project",
    "retrieve",
    "start",
    ...metadataFlags,
    "--output-dir",
    outputDir,
    "--json",
    ...getTargetOrgFlag(targetOrg),
  ];

  const stdout = await runSf(retrieveArgs, { timeoutMs: 180_000 });
  const parsed = parseSfJsonOrThrow<{
    status: number;
    message?: string;
    result?: {
      success?: boolean;
      files?: Array<{ filePath?: string; fullName?: string; state?: string }>;
    };
  }>(stdout);

  if (parsed.status !== 0) {
    throw new SfCliError(
      enhanceCliError(parsed.message || "Flow retrieve failed.")
    );
  }

  const files = (parsed.result?.files ?? [])
    .map((f) => f.filePath)
    .filter((p): p is string => Boolean(p));

  if (files.length === 0) {
    throw new SfCliError(
      `Retrieve reported success but wrote no files for Flow:${apiName}-${versions.join(",")}. ` +
        `Confirm the Flow version exists in the org and retry.`
    );
  }

  return files;
}
