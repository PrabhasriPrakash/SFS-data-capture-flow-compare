import { FlowDiffResult, FlowSnapshot, pruneNoiseProperties } from "./flowDiff";

export type UnifiedAction = "added" | "removed" | "modified";

export interface UnifiedRow {
  change: UnifiedAction;
  /** Element API name (for XML jump / selection). */
  name: string;
  kind: string;
  previousName?: string;
  /** Technical path (kept for XML jump / search). */
  propertyPath?: string;
  /** Human-readable meaning of the property path. */
  propertyLabel?: string;
  /** Display API name (or rename arrow previous → current). */
  element: string;
  /** Friendly label when present. */
  label?: string;
  left: string;
  right: string;
  search: string;
}

/** True when this property row is an element connector change. */
export function isConnectorProperty(path?: string): boolean {
  if (!path) {
    return false;
  }
  const p = path.trim();
  return (
    /^connector(\.targetReference)?$/i.test(p) ||
    /^defaultConnector(\.targetReference)?$/i.test(p) ||
    /^rules\[\d+\]\.connector(\.targetReference)?$/i.test(p) ||
    /^rules\.[^.]+\.connector(\.targetReference)?$/i.test(p) ||
    /\.connector(\.targetReference)?$/i.test(p)
  );
}

/** Element-column name: only rename true connector paths to "connector". */
export function humanizePropertyPath(path: string): string {
  if (isConnectorProperty(path)) {
    return "connector";
  }
  // Same-screen field rename: fields.OldApi→NewApi.name (also accept ->)
  if (
    /^fields\.[^.]+\u2192[^.]+\.name$/i.test(path) ||
    /^fields\.[^.]+->[^.]+\.name$/i.test(path)
  ) {
    return "name";
  }
  // Assignment retarget: assignmentItems.OldRef→NewRef.assignToReference
  if (
    /assignmentItems\.[^.]+\u2192[^.]+\.assignToReference$/i.test(path) ||
    /assignmentItems\.[^.]+->[^.]+\.assignToReference$/i.test(path)
  ) {
    return "assignToReference";
  }
  return path.trim();
}

/** API name → label from both snapshots (prefer whichever has a label). */
function buildLabelIndex(diff: FlowDiffResult): Map<string, string> {
  const map = new Map<string, string>();
  const ingest = (snap: FlowSnapshot) => {
    for (const el of snap.elements.values()) {
      const label = el.label?.trim();
      if (el.name && label) {
        map.set(el.name, label);
      }
    }
  };
  ingest(diff.left);
  ingest(diff.right);
  return map;
}

/** Display connector target as label when known; otherwise keep API name. */
export function displayConnectorTarget(
  raw: string,
  labels: Map<string, string>
): string {
  if (!raw || raw === "—") {
    return raw;
  }
  const clean = raw.replace(/^`+|`+$/g, "").trim();
  if (!clean || clean === "—") {
    return raw;
  }
  return labels.get(clean) || clean;
}

/**
 * Flatten all changes into one table:
 * Change Type | Label | API name | Element | Baseline | Compare.
 * Sorted: added → removed → modified, then by API name.
 */
export function buildUnifiedRows(diff: FlowDiffResult): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  const labels = buildLabelIndex(diff);

  for (const c of diff.changes) {
    const element = c.previousName ? `${c.previousName} → ${c.name}` : c.name;
    const label = c.rightLabel || c.leftLabel || undefined;

    if (c.properties.length > 0) {
      const pruned = pruneNoiseProperties(c.properties, {
        kind: c.kind,
        previousName: c.previousName,
        name: c.name,
      });
      if (pruned.length === 0) {
        // Properties existed but all pruned — still show an element-level row.
        const left =
          c.change === "added"
            ? "—"
            : c.details[0] || (label ? String(label) : "Element present");
        const right =
          c.change === "removed"
            ? "—"
            : c.details[0] || (label ? String(label) : "Element present");
        rows.push({
          change: c.change,
          name: c.name,
          kind: c.kind,
          previousName: c.previousName,
          element,
          label,
          left,
          right,
          search: [c.change, c.kind, element, label, ...c.details]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        });
        continue;
      }
      for (const p of pruned) {
        const propertyLabel = humanizePropertyPath(p.path);
        const connector = isConnectorProperty(p.path);
        const left = connector ? displayConnectorTarget(p.left, labels) : p.left;
        const right = connector
          ? displayConnectorTarget(p.right, labels)
          : p.right;
        rows.push({
          change: c.change,
          name: c.name,
          kind: c.kind,
          previousName: c.previousName,
          propertyPath: p.path,
          propertyLabel,
          element,
          label,
          left,
          right,
          search: [
            c.change,
            c.kind,
            element,
            label,
            p.path,
            propertyLabel,
            p.left,
            p.right,
            left,
            right,
            ...c.details,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        });
      }
    } else {
      const left =
        c.change === "added"
          ? "—"
          : c.details[0] || (label ? String(label) : "Element present");
      const right =
        c.change === "removed"
          ? "—"
          : c.details[0] || (label ? String(label) : "Element present");
      rows.push({
        change: c.change,
        name: c.name,
        kind: c.kind,
        previousName: c.previousName,
        element,
        label,
        left,
        right,
        search: [c.change, c.kind, element, label, ...c.details]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }
  }

  const order: Record<UnifiedAction, number> = {
    added: 0,
    removed: 1,
    modified: 2,
  };
  rows.sort((a, b) => {
    if (a.change !== b.change) {
      return order[a.change] - order[b.change];
    }
    const byEl = a.element.localeCompare(b.element);
    if (byEl !== 0) {
      return byEl;
    }
    return (a.propertyPath || "").localeCompare(b.propertyPath || "");
  });

  return rows;
}

/** Counts that match visible table rows (not unique flow elements). */
export function countUnifiedRows(rows: UnifiedRow[]): {
  all: number;
  added: number;
  removed: number;
  modified: number;
} {
  return {
    all: rows.length,
    added: rows.filter((r) => r.change === "added").length,
    removed: rows.filter((r) => r.change === "removed").length,
    modified: rows.filter((r) => r.change === "modified").length,
  };
}

export function valueCellClass(
  side: "left" | "right",
  left: string,
  right: string
): string {
  const leftEmpty = !left || left === "—";
  const rightEmpty = !right || right === "—";
  if (side === "right" && leftEmpty && !rightEmpty) {
    return "val-add";
  }
  if (side === "left" && !leftEmpty && rightEmpty) {
    return "val-rem";
  }
  if (side === "left" && !leftEmpty && !rightEmpty && left !== right) {
    return "val-rem";
  }
  if (side === "right" && !leftEmpty && !rightEmpty && left !== right) {
    return "val-add";
  }
  return "";
}

/** Only tint short values; long blobs get a thin accent bar, not a painted background. */
export function isShortValue(value: string): boolean {
  return !value || value === "—" || value.length <= 48;
}
