import * as vscode from "vscode";
import { queryToolingJson } from "./sfCli";

export interface FlowDefinitionSummary {
  Id: string;
  DeveloperName: string;
  MasterLabel: string;
  ActiveVersionId?: string;
  LatestVersionId?: string;
}

export interface FlowVersionSummary {
  Id: string;
  DefinitionId: string;
  VersionNumber: number;
  Status: string;
  ProcessType: string;
  Description?: string;
  LastModifiedDate?: string;
  LastModifiedBy?: { Name?: string };
}

/** Short-lived caches for one compare wizard session (flow definitions only). */
const flowDefCache = new Map<string, FlowDefinitionSummary[]>();

export function clearFlowPickCaches(): void {
  flowDefCache.clear();
}

function cacheKey(targetOrg?: string): string {
  return (targetOrg || "__default__").trim();
}

/**
 * Fast Data Capture listing: one Flow query for DefinitionIds, then one
 * FlowDefinition query — avoids N chunked ProcessType lookups across all flows.
 */
async function listDataCaptureDefinitionsFast(
  targetOrg?: string
): Promise<FlowDefinitionSummary[]> {
  type FlowRow = {
    DefinitionId?: string;
    Definition?: {
      Id?: string;
      DeveloperName?: string;
      MasterLabel?: string;
      ActiveVersionId?: string;
      LatestVersionId?: string;
    };
  };

  // Prefer relationship fields (single round-trip). Fall back if org rejects them.
  try {
    const rows = await queryToolingJson<FlowRow>(
      `SELECT DefinitionId, Definition.Id, Definition.DeveloperName, Definition.MasterLabel,
              Definition.ActiveVersionId, Definition.LatestVersionId
       FROM Flow
       WHERE ProcessType = 'DataCaptureFlow' AND Status IN ('Active','Draft')
       ORDER BY Definition.DeveloperName`,
      targetOrg
    );
    const byId = new Map<string, FlowDefinitionSummary>();
    for (const row of rows) {
      const id = row.Definition?.Id || row.DefinitionId;
      const name = row.Definition?.DeveloperName;
      if (!id || !name || byId.has(id)) {
        continue;
      }
      byId.set(id, {
        Id: id,
        DeveloperName: name,
        MasterLabel: row.Definition?.MasterLabel || name,
        ActiveVersionId: row.Definition?.ActiveVersionId,
        LatestVersionId: row.Definition?.LatestVersionId,
      });
    }
    if (byId.size > 0) {
      return [...byId.values()].sort((a, b) =>
        a.DeveloperName.localeCompare(b.DeveloperName)
      );
    }
  } catch {
    // Fall through to DefinitionId-only path.
  }

  const idRows = await queryToolingJson<{ DefinitionId: string }>(
    `SELECT DefinitionId FROM Flow WHERE ProcessType = 'DataCaptureFlow' AND Status IN ('Active','Draft')`,
    targetOrg
  );
  const defIds = [
    ...new Set(idRows.map((r) => r.DefinitionId).filter(Boolean)),
  ];
  if (defIds.length === 0) {
    return [];
  }

  const defs: FlowDefinitionSummary[] = [];
  const chunkSize = 100;
  for (let i = 0; i < defIds.length; i += chunkSize) {
    const chunk = defIds.slice(i, i + chunkSize);
    const inList = chunk.map((id) => `'${id}'`).join(",");
    const part = await queryToolingJson<FlowDefinitionSummary>(
      `SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, LatestVersionId
       FROM FlowDefinition WHERE Id IN (${inList}) ORDER BY DeveloperName`,
      targetOrg
    );
    defs.push(...part);
  }
  return defs;
}

export async function listFlowDefinitions(
  onlyDataCapture: boolean,
  targetOrg?: string
): Promise<FlowDefinitionSummary[]> {
  const key = `${cacheKey(targetOrg)}|dc:${onlyDataCapture ? 1 : 0}`;
  const cached = flowDefCache.get(key);
  if (cached) {
    return cached;
  }

  let defs: FlowDefinitionSummary[];
  if (onlyDataCapture) {
    defs = await listDataCaptureDefinitionsFast(targetOrg);
  } else {
    defs = await queryToolingJson<FlowDefinitionSummary>(
      "SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, LatestVersionId FROM FlowDefinition ORDER BY MasterLabel",
      targetOrg
    );
  }

  flowDefCache.set(key, defs);
  return defs;
}

/** @deprecated Use listFlowDefinitions */
export const listDataCaptureFlowDefinitions = listFlowDefinitions;

export async function listFlowVersions(
  definitionId: string,
  targetOrg?: string
): Promise<FlowVersionSummary[]> {
  // Always fetch fresh — versions change when users save/activate drafts.
  return queryToolingJson<FlowVersionSummary>(
    `SELECT Id, DefinitionId, VersionNumber, Status, ProcessType, Description, LastModifiedDate, LastModifiedBy.Name
     FROM Flow
     WHERE DefinitionId = '${definitionId}'
     ORDER BY VersionNumber DESC`,
    targetOrg
  );
}

export async function findFlowByApiName(
  apiName: string,
  onlyDataCapture: boolean,
  targetOrg?: string
): Promise<FlowDefinitionSummary | undefined> {
  const defs = await listFlowDefinitions(onlyDataCapture, targetOrg);
  return defs.find((d) => d.DeveloperName === apiName);
}

export async function pickFlowDefinition(
  onlyDataCapture: boolean,
  options?: { targetOrg?: string; placeHolder?: string; preferApiName?: string }
): Promise<FlowDefinitionSummary | undefined> {
  const targetOrg = options?.targetOrg;
  const orgHint = targetOrg ? ` (${targetOrg})` : "";
  const cacheHit = flowDefCache.has(
    `${cacheKey(targetOrg)}|dc:${onlyDataCapture ? 1 : 0}`
  );

  const load = async () => {
    const defs = await listFlowDefinitions(onlyDataCapture, targetOrg);
    if (defs.length === 0) {
      void vscode.window.showWarningMessage(
        onlyDataCapture
          ? `No Data Capture flows found${orgHint}. Tip: turn off dcFlowCompare.onlyDataCaptureFlows to list all flows.`
          : `No flows found${orgHint}.`
      );
      return undefined;
    }

    const items = defs.map((d) => ({
      label: d.DeveloperName,
      description:
        d.MasterLabel && d.MasterLabel !== d.DeveloperName
          ? d.MasterLabel
          : undefined,
      flow: d,
    }));

    if (options?.preferApiName) {
      items.sort((a, b) => {
        const aMatch = a.label === options.preferApiName ? 0 : 1;
        const bMatch = b.label === options.preferApiName ? 0 : 1;
        if (aMatch !== bMatch) {
          return aMatch - bMatch;
        }
        return a.label.localeCompare(b.label);
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder:
        options?.placeHolder ||
        (onlyDataCapture
          ? `Select a Data Capture flow${orgHint}`
          : `Select a flow${orgHint}`),
      matchOnDescription: true,
    });
    return picked?.flow;
  };

  if (cacheHit) {
    return load();
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: onlyDataCapture
        ? `Loading Data Capture flows${orgHint}…`
        : `Loading flows${orgHint}…`,
      cancellable: false,
    },
    () => load()
  );
}

function toPickItem(v: FlowVersionSummary) {
  const badges: string[] = [];
  if (v.Status === "Active") {
    badges.push("$(check) Active");
  } else if (v.Status === "Draft") {
    badges.push("Draft");
  } else if (v.Status === "Obsolete") {
    badges.push("Obsolete");
  } else if (v.Status) {
    badges.push(v.Status);
  }

  return {
    label: `v${v.VersionNumber}`,
    description: badges.join(" · "),
    detail: [
      v.ProcessType,
      v.LastModifiedDate
        ? `Modified ${new Date(v.LastModifiedDate).toLocaleString()}`
        : undefined,
      v.LastModifiedBy?.Name,
      v.Description,
    ]
      .filter(Boolean)
      .join(" · "),
    version: v,
  };
}

export async function pickOneVersion(
  definitionId: string,
  apiName: string,
  targetOrg?: string
): Promise<FlowVersionSummary | undefined> {
  const orgHint = targetOrg ? ` (${targetOrg})` : "";

  const load = async () => {
    const versions = await listFlowVersions(definitionId, targetOrg);
    if (versions.length === 0) {
      void vscode.window.showWarningMessage(
        `${apiName} has no versions${orgHint}.`
      );
      return undefined;
    }

    const items = versions.map(toPickItem);
    items.sort((a, b) => {
      const aActive = a.version.Status === "Active" ? 0 : 1;
      const bActive = b.version.Status === "Active" ? 0 : 1;
      if (aActive !== bActive) {
        return aActive - bActive;
      }
      return b.version.VersionNumber - a.version.VersionNumber;
    });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Select version of ${apiName}${orgHint}`,
    });
    return picked?.version;
  };

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Loading versions${orgHint}…`,
      cancellable: false,
    },
    () => load()
  );
}

export async function pickTwoVersions(
  definitionId: string,
  apiName: string,
  targetOrg?: string
): Promise<[FlowVersionSummary, FlowVersionSummary] | undefined> {
  const versions = await listFlowVersions(definitionId, targetOrg);
  if (versions.length < 2) {
    void vscode.window.showWarningMessage(
      `${apiName} has fewer than 2 versions to compare.`
    );
    return undefined;
  }

  const active = versions.find((v) => v.Status === "Active");
  const latest = [...versions].sort(
    (a, b) => b.VersionNumber - a.VersionNumber
  )[0];

  if (active && latest && active.Id !== latest.Id) {
    const [older, newer] =
      active.VersionNumber <= latest.VersionNumber
        ? [active, latest]
        : [latest, active];

    const mode = await vscode.window.showQuickPick(
      [
        {
          label: "$(git-compare) Active vs Latest",
          description: `v${older.VersionNumber} → v${newer.VersionNumber}`,
          detail: `Active v${active.VersionNumber} · Latest v${latest.VersionNumber}`,
          mode: "activeLatest" as const,
        },
        {
          label: "$(list-selection) Pick two versions manually",
          description: "Choose baseline and compare versions",
          mode: "manual" as const,
        },
      ],
      { placeHolder: `Compare versions of ${apiName}` }
    );
    if (!mode) {
      return undefined;
    }
    if (mode.mode === "activeLatest") {
      return [older, newer];
    }
  }

  const items = versions.map(toPickItem);
  items.sort((a, b) => {
    const aActive = a.version.Status === "Active" ? 0 : 1;
    const bActive = b.version.Status === "Active" ? 0 : 1;
    if (aActive !== bActive) {
      return aActive - bActive;
    }
    return b.version.VersionNumber - a.version.VersionNumber;
  });

  const left = await vscode.window.showQuickPick(items, {
    placeHolder: "Select the OLDER / baseline version",
  });
  if (!left) {
    return undefined;
  }

  const right = await vscode.window.showQuickPick(
    items.filter((i) => i.version.Id !== left.version.Id),
    { placeHolder: "Select the NEWER / compare-to version" }
  );
  if (!right) {
    return undefined;
  }

  return [left.version, right.version];
}
