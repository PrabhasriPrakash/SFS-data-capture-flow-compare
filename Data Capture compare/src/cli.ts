#!/usr/bin/env node
/**
 * CLI entry for Cursor skill / terminal use.
 * Reuses the same diff engine as the VSIX (flowDiff + unifiedTable).
 */
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import {
  diffFlowSnapshots,
  formatDiffMarkdown,
  parseFlowXml,
} from "./flowDiff";
import { parseSfJson } from "./sfJson";
import {
  buildUnifiedRows,
  countUnifiedRows,
  UnifiedRow,
} from "./unifiedTable";
import { versionLabelFromPath } from "./versionLabel";

const execFileAsync = promisify(execFile);

type Args = {
  mode?: "local" | "org" | "help";
  left?: string;
  right?: string;
  flow?: string;
  leftVersion?: number;
  rightVersion?: number;
  org?: string;
  leftOrg?: string;
  rightOrg?: string;
  projectDir?: string;
  format?: "markdown" | "table" | "json";
  includeLayout?: boolean;
  includeProcessMetadata?: boolean;
};

function printHelp(): void {
  console.log(`Data Capture Flow Compare CLI (same engine as the VSIX)

Usage:
  dc-flow-compare local <left.flow-meta.xml> <right.flow-meta.xml> [options]
  dc-flow-compare org <FlowApiName> --left <n> --right <n> [options]

Options:
  --org <alias>           Target org for both sides (same-org compare)
  --left-org <alias>      Org for baseline version (cross-org)
  --right-org <alias>     Org for compare version (cross-org)
  --project-dir <path>    SFDX project root for retrieve (default: cwd)
  --format markdown|table|json   Output format (default: table)
  --include-layout        Include locationX/Y noise
  --include-process-metadata  Include processMetadataValues noise
  -h, --help              Show help

Examples:
  dc-flow-compare local ./a.flow-meta.xml ./b.flow-meta.xml
  dc-flow-compare org RevisitForm --left 36 --right 37 --org mySandbox
  dc-flow-compare org RevisitForm --left 10 --right 12 --left-org dev --right-org uat
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { format: "table" };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) {
        throw new Error(`Missing value after ${a}`);
      }
      return v;
    };
    switch (a) {
      case "-h":
      case "--help":
        args.mode = "help";
        break;
      case "--org":
        args.org = next();
        break;
      case "--left-org":
        args.leftOrg = next();
        break;
      case "--right-org":
        args.rightOrg = next();
        break;
      case "--left":
        args.leftVersion = Number(next());
        break;
      case "--right":
        args.rightVersion = Number(next());
        break;
      case "--project-dir":
        args.projectDir = next();
        break;
      case "--format":
        args.format = next() as Args["format"];
        break;
      case "--include-layout":
        args.includeLayout = true;
        break;
      case "--include-process-metadata":
        args.includeProcessMetadata = true;
        break;
      default:
        if (a.startsWith("-")) {
          throw new Error(`Unknown option: ${a}`);
        }
        positional.push(a);
    }
  }

  if (args.mode === "help") {
    return args;
  }

  if (positional[0] === "local") {
    args.mode = "local";
    args.left = positional[1];
    args.right = positional[2];
  } else if (positional[0] === "org") {
    args.mode = "org";
    args.flow = positional[1];
  } else if (positional.length >= 2 && positional[0].endsWith(".xml")) {
    args.mode = "local";
    args.left = positional[0];
    args.right = positional[1];
  } else if (positional.length === 0) {
    args.mode = "help";
  } else {
    throw new Error(
      `Unrecognized command. Got: ${positional.join(" ")}. Use --help.`
    );
  }
  return args;
}

async function runSf(
  sfArgs: string[],
  cwd?: string
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("sf", sfArgs, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 180_000,
      env: process.env,
    });
    return stdout;
  } catch (err) {
    const e = err as {
      stderr?: string;
      stdout?: string;
      message?: string;
    };
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n");
    throw new Error(`sf ${sfArgs.join(" ")} failed:\n${detail}`);
  }
}

function targetOrgFlags(alias?: string): string[] {
  return alias?.trim() ? ["--target-org", alias.trim()] : [];
}

function findRetrievedFlowFile(
  retrieveRoot: string,
  apiName: string,
  version: number
): string | undefined {
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

async function retrieveOneVersion(options: {
  apiName: string;
  version: number;
  targetOrg?: string;
  projectDir: string;
  outFile: string;
}): Promise<string> {
  // sf retrieve requires --output-dir inside the project root.
  const stagingRoot = path.join(options.projectDir, "tmp", "dc-flow-compare");
  fs.mkdirSync(stagingRoot, { recursive: true });
  const staging = fs.mkdtempSync(
    path.join(stagingRoot, `cli-${options.version}-`)
  );
  try {
    const stdout = await runSf(
      [
        "project",
        "retrieve",
        "start",
        "--metadata",
        `Flow:${options.apiName}-${options.version}`,
        "--output-dir",
        staging,
        "--json",
        ...targetOrgFlags(options.targetOrg),
      ],
      options.projectDir
    );
    const parsed = parseSfJson<{
      status: number;
      message?: string;
      result?: { files?: Array<{ filePath?: string }> };
    }>(stdout);
    if (parsed.status !== 0) {
      throw new Error(parsed.message || "Flow retrieve failed.");
    }
    const written = (parsed.result?.files ?? [])
      .map((f) => f.filePath)
      .filter((p): p is string => Boolean(p));
    const found =
      written.find(
        (p) => p.endsWith(".flow-meta.xml") || p.endsWith(".flow")
      ) ||
      findRetrievedFlowFile(staging, options.apiName, options.version);
    if (!found || !fs.existsSync(found)) {
      throw new Error(
        `Retrieve succeeded but XML for ${options.apiName} v${options.version} was not found.`
      );
    }
    fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
    fs.copyFileSync(found, options.outFile);
    return options.outFile;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function formatTableMarkdown(
  rows: UnifiedRow[],
  leftLabel: string,
  rightLabel: string
): string {
  const counts = countUnifiedRows(rows);
  const lines: string[] = [
    `# Data Capture Flow compare`,
    ``,
    `**${counts.all}** row(s): **${counts.added}** added, **${counts.removed}** removed, **${counts.modified}** updated.`,
    ``,
    `| Change | Label | API name | Element | ${leftLabel} | ${rightLabel} |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const r of rows) {
    const change =
      r.change === "modified"
        ? "Updated"
        : r.change === "added"
          ? "Added"
          : "Removed";
    const element = [r.kind, r.propertyLabel || r.propertyPath]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `| ${change} | ${esc(r.label || "—")} | \`${esc(r.element)}\` | ${esc(element)} | ${esc(r.left)} | ${esc(r.right)} |`
    );
  }
  return lines.join("\n");
}

function esc(value: string): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function compareFiles(
  leftPath: string,
  rightPath: string,
  args: Args
): void {
  if (!fs.existsSync(leftPath)) {
    throw new Error(`Left file not found: ${leftPath}`);
  }
  if (!fs.existsSync(rightPath)) {
    throw new Error(`Right file not found: ${rightPath}`);
  }
  const noise = {
    ignoreLayoutNoise: !args.includeLayout,
    ignoreProcessMetadata: !args.includeProcessMetadata,
  };
  const leftXml = fs.readFileSync(leftPath, "utf8");
  const rightXml = fs.readFileSync(rightPath, "utf8");
  const diff = diffFlowSnapshots(
    parseFlowXml(leftXml, noise),
    parseFlowXml(rightXml, noise)
  );
  const leftLabel = versionLabelFromPath(leftPath) || "Baseline";
  const rightLabel = versionLabelFromPath(rightPath) || "Compare";

  if (args.format === "json") {
    const rows = buildUnifiedRows(diff);
    console.log(
      JSON.stringify(
        {
          left: leftPath,
          right: rightPath,
          processTypeChanged: diff.processTypeChanged,
          counts: countUnifiedRows(rows),
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  if (args.format === "markdown") {
    console.log(
      formatDiffMarkdown(diff, path.basename(leftPath), path.basename(rightPath), {
        ...noise,
        leftVersionLabel: leftLabel,
        rightVersionLabel: rightLabel,
      })
    );
    return;
  }

  console.log(
    formatTableMarkdown(buildUnifiedRows(diff), leftLabel, rightLabel)
  );
}

async function compareOrg(args: Args): Promise<void> {
  if (!args.flow) {
    throw new Error("org mode requires Flow API name.");
  }
  if (
    args.leftVersion == null ||
    args.rightVersion == null ||
    Number.isNaN(args.leftVersion) ||
    Number.isNaN(args.rightVersion)
  ) {
    throw new Error("org mode requires --left <n> and --right <n>.");
  }
  const projectDir = path.resolve(args.projectDir || process.cwd());
  if (!fs.existsSync(path.join(projectDir, "sfdx-project.json"))) {
    console.warn(
      `Warning: no sfdx-project.json under ${projectDir}. sf retrieve may fail.`
    );
  }
  const leftOrg = args.leftOrg || args.org;
  const rightOrg = args.rightOrg || args.org;
  const stagingRoot = path.join(projectDir, "tmp", "dc-flow-compare");
  fs.mkdirSync(stagingRoot, { recursive: true });
  const tempBase = fs.mkdtempSync(path.join(stagingRoot, "compare-"));
  try {
    const leftPath = path.join(
      tempBase,
      `${args.flow}-v${args.leftVersion}.flow-meta.xml`
    );
    const rightPath = path.join(
      tempBase,
      `${args.flow}-v${args.rightVersion}.flow-meta.xml`
    );
    await retrieveOneVersion({
      apiName: args.flow,
      version: args.leftVersion,
      targetOrg: leftOrg,
      projectDir,
      outFile: leftPath,
    });
    await retrieveOneVersion({
      apiName: args.flow,
      version: args.rightVersion,
      targetOrg: rightOrg,
      projectDir,
      outFile: rightPath,
    });
    compareFiles(leftPath, rightPath, args);
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.mode === "help" || !args.mode) {
      printHelp();
      process.exit(args.mode === "help" ? 0 : 1);
    }
    if (args.mode === "local") {
      if (!args.left || !args.right) {
        throw new Error("local mode requires two .flow-meta.xml paths.");
      }
      compareFiles(path.resolve(args.left), path.resolve(args.right), args);
      return;
    }
    if (args.mode === "org") {
      await compareOrg(args);
      return;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
