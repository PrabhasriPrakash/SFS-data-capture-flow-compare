import { XMLParser } from "fast-xml-parser";

const ELEMENT_COLLECTIONS = [
  "screens",
  "decisions",
  "assignments",
  "recordCreates",
  "recordUpdates",
  "recordLookups",
  "recordDeletes",
  "actionCalls",
  "subflows",
  "loops",
  "waits",
  "collectionProcessors",
  "transforms",
  "orchestratedStages",
  "customErrors",
] as const;

const RESOURCE_COLLECTIONS = [
  "variables",
  "constants",
  "formulas",
  "textTemplates",
  "choices",
  "dynamicChoiceSets",
  "stages",
] as const;

const ARRAY_TAGS = [
  ...ELEMENT_COLLECTIONS,
  ...RESOURCE_COLLECTIONS,
  "fields",
  "rules",
  "assignmentItems",
  "inputAssignments",
  "inputParameters",
  "outputParameters",
  "filters",
  "conditions",
  "processMetadataValues",
  "visibilityRule",
] as const;

/** Scalar / simple props to call out by name when they change. */
const TRACKED_SCALAR_PROPS = [
  "name",
  "label",
  "description",
  "dataType",
  "object",
  "objectType",
  "expression",
  "assignNullValuesIfNoRecordsFound",
  "getFirstRecordOnly",
  "storeOutputAutomatically",
  "filterLogic",
  "actionName",
  "actionType",
  "flowName",
  "interviewLabel",
  "fieldType",
  "fieldText",
  "dataTypeMappings",
  "isRequired",
  "isReadOnly",
  "defaultValue",
  "choiceReferences",
  "scale",
  "status",
] as const;

export type FlowElementKind =
  | (typeof ELEMENT_COLLECTIONS)[number]
  | (typeof RESOURCE_COLLECTIONS)[number]
  | "start"
  | "flow"
  | "unknown";

export interface FlowElementSnapshot {
  kind: FlowElementKind;
  name: string;
  label?: string;
  /** Stable-ish fingerprint for equality (layout coords optionally stripped). */
  fingerprint: string;
  /** Cleaned element object used for property-level diffs. */
  raw: Record<string, unknown>;
}

export interface FlowSnapshot {
  apiName?: string;
  label?: string;
  processType?: string;
  status?: string;
  interviewLabel?: string;
  elements: Map<string, FlowElementSnapshot>;
}

export interface PropertyChange {
  /** Dot path, e.g. label, assignmentItems.Field__c.value, fields.Reason.isRequired */
  path: string;
  left: string;
  right: string;
}

/**
 * Drop no-op and redundant parent rows when a more specific child change exists.
 * Example: drop `rules.Yes` when `rules.Yes.conditions[2]` is present.
 *
 * Also:
 * - Choices: collapse name + choiceText + value into one `name` row when API name changes
 * - Screens: keep indexed `choiceReferences[n]` and drop the whole-array duplicate
 */
export function pruneNoiseProperties(
  properties: PropertyChange[],
  options?: {
    kind?: FlowElementKind;
    previousName?: string;
    name?: string;
  }
): PropertyChange[] {
  const meaningful = properties.filter((p) => {
    const left = String(p.left ?? "");
    const right = String(p.right ?? "");
    return left !== right;
  });

  const paths = meaningful.map((p) => p.path);
  let result = meaningful.filter((p) => {
    return !paths.some(
      (other) =>
        other !== p.path &&
        (other.startsWith(`${p.path}.`) || other.startsWith(`${p.path}[`))
    );
  });

  if (options?.kind === "choices") {
    result = collapseChoiceProperties(result, options);
  }

  result = preferIndexedChoiceReferences(result);
  if (options?.kind === "screens") {
    result = preferFlatScreenFieldAddRemove(result);
  }
  return result;
}

/**
 * One canvas row for a Choice API rename / update: keep `name`, drop mirrored
 * `choiceText` and `value.stringValue` noise when the API name also changed.
 */
function collapseChoiceProperties(
  properties: PropertyChange[],
  options: { previousName?: string; name?: string }
): PropertyChange[] {
  const nameProp = properties.find(
    (p) => p.path === "name" || /(^|\.)name$/.test(p.path)
  );
  if (!nameProp && !options.previousName) {
    return properties;
  }

  const left = options.previousName || nameProp?.left || "—";
  const right = options.name || nameProp?.right || "—";
  if (left === right && !nameProp) {
    return properties;
  }

  // If API name didn't change, don't collapse other property edits.
  if (!options.previousName && nameProp && nameProp.left === nameProp.right) {
    return properties;
  }
  if (!options.previousName && !nameProp) {
    return properties;
  }

  return [
    {
      path: "name",
      left: String(left),
      right: String(right),
    },
  ];
}

/**
 * Prefer `….field.choiceReferences[n]` over `….field.choiceReferences` (array).
 */
function preferIndexedChoiceReferences(
  properties: PropertyChange[]
): PropertyChange[] {
  const indexedFields = new Set<string>();
  for (const p of properties) {
    const m = p.path.match(/(?:^|\.)([^.\[]+)\.choiceReferences\[\d+\]$/);
    if (m) {
      indexedFields.add(m[1]);
    }
  }
  if (indexedFields.size === 0) {
    return properties;
  }
  return properties.filter((p) => {
    const whole = p.path.match(/(?:^|\.)([^.\[]+)\.choiceReferences$/);
    if (whole && indexedFields.has(whole[1])) {
      return false;
    }
    return true;
  });
}

/**
 * One add/remove row per screen field API name. Prefer short `fields.Name`
 * over nested section paths (same field dumped twice).
 */
function preferFlatScreenFieldAddRemove(
  properties: PropertyChange[]
): PropertyChange[] {
  const isAddOrRemove = (p: PropertyChange) =>
    p.left === "—" || p.right === "—";

  const fieldLeaf = (path: string): string | null => {
    const m = path.match(/(?:^|\.fields\.)([^.\[]+)$/);
    return m ? m[1] : null;
  };

  const byLeaf = new Map<string, PropertyChange[]>();
  const other: PropertyChange[] = [];
  for (const p of properties) {
    if (!isAddOrRemove(p)) {
      other.push(p);
      continue;
    }
    const leaf = fieldLeaf(p.path);
    if (!leaf || leaf === "fields") {
      other.push(p);
      continue;
    }
    // Skip property-level adds under an added field (fields.X.inputParameters…)
    if (/\.fields\.[^.\[]+\./.test(p.path) || /^fields\.[^.\[]+\./.test(p.path)) {
      // e.g. fields.Foo.isRequired on add — overkill; drop if whole-field add exists later
      const parentLeaf = p.path.match(/(?:^|\.fields\.)([^.\[]+)\./);
      if (parentLeaf) {
        const bucket = byLeaf.get(parentLeaf[1]) || [];
        bucket.push(p);
        byLeaf.set(parentLeaf[1], bucket);
        continue;
      }
    }
    const bucket = byLeaf.get(leaf) || [];
    bucket.push(p);
    byLeaf.set(leaf, bucket);
  }

  const collapsed: PropertyChange[] = [];
  for (const [, group] of byLeaf) {
    const wholeField = group.filter((p) => {
      const leaf = fieldLeaf(p.path);
      return (
        leaf != null &&
        (p.path === `fields.${leaf}` || p.path.endsWith(`.fields.${leaf}`))
      );
    });
    if (wholeField.length > 0) {
      // Prefer shortest path (flat fields.Name).
      wholeField.sort((a, b) => a.path.length - b.path.length);
      collapsed.push(wholeField[0]);
      continue;
    }
    // No whole-field row — keep group as-is (genuine property adds are rare).
    collapsed.push(...group);
  }

  return [...other, ...collapsed];
}

export interface ElementChange {
  name: string;
  kind: FlowElementKind;
  change: "added" | "removed" | "modified";
  leftLabel?: string;
  rightLabel?: string;
  /** Previous API name when this modified change includes a rename. */
  previousName?: string;
  /** Human-readable property / child-item changes. */
  details: string[];
  /** Structured Left/Right property rows for the summary table. */
  properties: PropertyChange[];
}

export interface FlowDiffResult {
  left: FlowSnapshot;
  right: FlowSnapshot;
  changes: ElementChange[];
  processTypeChanged: boolean;
}

/** Options that control which metadata differences are treated as noise. */
export interface NoiseOptions {
  ignoreLayoutNoise?: boolean;
  /** Drop processMetadataValues (builder canvas metadata) from fingerprints. */
  ignoreProcessMetadata?: boolean;
}

export const DEFAULT_NOISE_OPTIONS: Required<NoiseOptions> = {
  ignoreLayoutNoise: true,
  ignoreProcessMetadata: true,
};

function resolveNoise(options?: boolean | NoiseOptions): Required<NoiseOptions> {
  // Back-compat: parseFlowXml(xml, true) used to mean ignoreLayoutNoise.
  if (typeof options === "boolean") {
    return {
      ignoreLayoutNoise: options,
      ignoreProcessMetadata: DEFAULT_NOISE_OPTIONS.ignoreProcessMetadata,
    };
  }
  return {
    ignoreLayoutNoise:
      options?.ignoreLayoutNoise ?? DEFAULT_NOISE_OPTIONS.ignoreLayoutNoise,
    ignoreProcessMetadata:
      options?.ignoreProcessMetadata ??
      DEFAULT_NOISE_OPTIONS.ignoreProcessMetadata,
  };
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stripNoise(
  value: unknown,
  noise: Required<NoiseOptions>,
  parentKey?: string
): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((v) => stripNoise(v, noise));
    // Assignment order in Flow XML is not meaningful for compare.
    if (parentKey === "assignmentItems") {
      return sortByAssignmentIdentity(mapped);
    }
    return mapped;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (noise.ignoreLayoutNoise && (k === "locationX" || k === "locationY")) {
        continue;
      }
      if (noise.ignoreProcessMetadata && k === "processMetadataValues") {
        continue;
      }
      out[k] = stripNoise(v, noise, k);
    }
    return out;
  }
  return value;
}

/** Stable order so reorder-only assignment lists do not count as changes. */
function sortByAssignmentIdentity(items: unknown[]): unknown[] {
  return [...items].sort((a, b) =>
    assignmentIdentityKey(a).localeCompare(assignmentIdentityKey(b))
  );
}

function assignmentIdentityKey(item: unknown): string {
  if (!item || typeof item !== "object") {
    return stableStringify(item);
  }
  const row = item as Record<string, unknown>;
  return [
    String(row.assignToReference ?? ""),
    stableStringify(row.operator ?? null),
    stableStringify(row.value ?? null),
  ].join("\0");
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** Data Capture screen component API → builder-friendly label */
const DC_FIELD_TYPE_LABELS: Record<string, string> = {
  dcPicklist: "Picklist",
  dcRbGroup: "Radio",
  dcCbGroup: "Checkbox Group",
  dcCheckbox: "Checkbox",
  dcTextInput: "Text",
  dcLongText: "Long Text",
  dcNumeric: "Number",
  dcDate: "Date",
  dcDateTime: "Date/Time",
  dcPhone: "Phone",
  dcAddress: "Address",
  dcUpImage: "Image Upload",
};

function friendlyDcFieldType(value: string): string {
  const trimmed = value.trim();
  const short = trimmed.includes(":")
    ? trimmed.slice(trimmed.lastIndexOf(":") + 1)
    : trimmed;
  return DC_FIELD_TYPE_LABELS[short] ?? trimmed;
}

function formatValue(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    let text = String(value);
    if (
      typeof value === "string" &&
      (text.includes("runtime_service_fieldservice:") ||
        /^dc[A-Z][A-Za-z0-9]*$/.test(text))
    ) {
      text = friendlyDcFieldType(text);
    }
    return text;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.stringValue != null) {
      return formatValue(obj.stringValue);
    }
    if (obj.elementReference != null) {
      return `{!${obj.elementReference}}`;
    }
    if (obj.numberValue != null) {
      return formatValue(obj.numberValue);
    }
    if (obj.booleanValue != null) {
      return formatValue(obj.booleanValue);
    }
    if (obj.targetReference != null) {
      return String(obj.targetReference);
    }
    // Screen / DC field objects — brief type + label (full dumps are overkill).
    if (obj.extensionName != null || obj.fieldType != null || obj.fieldText != null) {
      return summarizeScreenFieldBrief(obj);
    }
    return stableStringify(value);
  }
  return String(value);
}

/** Short canvas label for a screen field add/remove (not every inputParameter). */
function summarizeScreenFieldBrief(field: Record<string, unknown>): string {
  const type =
    field.extensionName != null
      ? friendlyDcFieldType(String(field.extensionName))
      : field.fieldType != null
        ? String(formatValue(field.fieldType))
        : null;
  let text: string | null =
    field.fieldText != null ? String(formatValue(field.fieldText)) : null;
  if (!text || text === "—") {
    for (const raw of asArray(field.inputParameters)) {
      const row = raw as Record<string, unknown>;
      if (String(row.name ?? "") === "label") {
        const v = formatValue(row.value);
        if (v && v !== "—") {
          text = v;
          break;
        }
      }
    }
  }
  if (type && text) {
    return `${type} — ${text}`;
  }
  if (type) {
    return type;
  }
  if (text) {
    return text;
  }
  return String(field.name ?? "field");
}

function childKey(
  item: Record<string, unknown>,
  preferredKeys: string[]
): string {
  for (const key of preferredKeys) {
    if (item[key] != null && String(item[key]).trim() !== "") {
      return String(item[key]);
    }
  }
  return stableStringify(item);
}

function flattenScreenFields(
  fields: unknown,
  prefix = ""
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const field of asArray(fields)) {
    const f = field as Record<string, unknown>;
    const name = String(f.name ?? "").trim();
    const path = prefix
      ? `${prefix}/${name || "?"}`
      : name || childKey(f, ["fieldText", "fieldType"]);
    // Key by API name when present (unique in a Flow). Keep path only as fallback.
    const key = name || path;
    if (name || f.fieldText || f.fieldType || f.extensionName) {
      // Prefer leaf/control entries; later walks overwrite only if same name (last wins).
      if (!map.has(key) || !asArray(f.fields).length) {
        map.set(key, { ...f, __screenPath: path });
      }
    }
    if (f.fields) {
      for (const [k, v] of flattenScreenFields(f.fields, path || "region")) {
        map.set(k, v);
      }
    }
  }
  return map;
}

/** Label-ish input params that often change when a field is renamed. */
const SCREEN_FIELD_LABEL_INPUTS = new Set([
  "label",
  "imagesName",
  "fieldLabel",
  "title",
]);

/**
 * Normalize screen-field body for rename matching:
 * ignore API name/label/coords, drop label-ish inputs, sort keyed input lists.
 */
function screenFieldRenameFingerprint(
  field: Record<string, unknown>
): string {
  const inputs = asArray(field.inputParameters)
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const name = String(row.name ?? "");
      if (SCREEN_FIELD_LABEL_INPUTS.has(name)) {
        return null;
      }
      return { name, value: row.value };
    })
    .filter((x): x is { name: string; value: unknown } => x != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return stableStringify({
    fieldType: field.fieldType ?? null,
    extensionName: field.extensionName ?? null,
    dataType: field.dataType ?? null,
    isRequired: field.isRequired ?? null,
    isReadOnly: field.isReadOnly ?? null,
    choiceReferences: field.choiceReferences ?? null,
    storeOutputAutomatically: field.storeOutputAutomatically ?? null,
    inputsOnNextNavToAssocScrn: field.inputsOnNextNavToAssocScrn ?? null,
    visibilityRule: field.visibilityRule ?? null,
    styleProperties: field.styleProperties ?? null,
    inputParameters: inputs,
  });
}

function screenFieldParentPath(field: Record<string, unknown>): string {
  const p = String(field.__screenPath ?? "");
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(0, slash) : "";
}

function screenFieldsSamePlace(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const lx = left.locationX;
  const ly = left.locationY;
  const rx = right.locationX;
  const ry = right.locationY;
  if (lx != null && ly != null && rx != null && ry != null) {
    return String(lx) === String(rx) && String(ly) === String(ry);
  }
  return screenFieldParentPath(left) === screenFieldParentPath(right);
}

/** Photoofriserchamber1 ↔ Photoofriserchamber style renames. */
function namesLookLikeFieldRename(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y || x === y) {
    return false;
  }
  if (x.startsWith(y) || y.startsWith(x)) {
    return true;
  }
  const stem = (s: string) => s.replace(/\d+$/u, "");
  if (stem(x) && stem(x) === stem(y)) {
    return true;
  }
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) {
    i++;
  }
  const minLen = Math.min(x.length, y.length);
  return i >= 6 && i >= minLen * 0.65;
}

function sameScreenFieldType(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  return (
    stableStringify(left.fieldType ?? null) ===
      stableStringify(right.fieldType ?? null) &&
    stableStringify(left.extensionName ?? null) ===
      stableStringify(right.extensionName ?? null)
  );
}

/**
 * True when left/right are the same control with only name and/or label changed.
 * Uses a normalized fingerprint (order-independent inputs; label inputs ignored).
 */
function isSameScreenFieldRename(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  oldName: string,
  newName: string
): boolean {
  if (!screenFieldsSamePlace(left, right)) {
    return false;
  }
  if (screenFieldRenameFingerprint(left) === screenFieldRenameFingerprint(right)) {
    return true;
  }
  // Fallback: same component type + rename-like API names (handles minor
  // visibility/input drift Salesforce sometimes writes on rename).
  return (
    sameScreenFieldType(left, right) &&
    namesLookLikeFieldRename(oldName, newName)
  );
}

/**
 * Pair removed ↔ added fields on one screen when only API name / label differs.
 * Greedy 1:1; ambiguous leftover pairs are left as remove+add.
 */
function pairSameScreenFieldRenames(
  leftOnly: Map<string, Record<string, unknown>>,
  rightOnly: Map<string, Record<string, unknown>>
): Array<{
  oldName: string;
  newName: string;
  left: Record<string, unknown>;
  right: Record<string, unknown>;
}> {
  const pairs: Array<{
    oldName: string;
    newName: string;
    left: Record<string, unknown>;
    right: Record<string, unknown>;
  }> = [];
  const usedRight = new Set<string>();
  for (const [oldName, left] of [...leftOnly.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const candidates: string[] = [];
    for (const [newName, right] of rightOnly) {
      if (usedRight.has(newName)) {
        continue;
      }
      if (isSameScreenFieldRename(left, right, oldName, newName)) {
        candidates.push(newName);
      }
    }
    // Prefer rename-like names when multiple soft matches.
    const preferred = candidates.filter((n) =>
      namesLookLikeFieldRename(oldName, n)
    );
    const chosen =
      preferred.length === 1
        ? preferred[0]
        : candidates.length === 1
          ? candidates[0]
          : null;
    if (!chosen) {
      continue;
    }
    usedRight.add(chosen);
    pairs.push({
      oldName,
      newName: chosen,
      left,
      right: rightOnly.get(chosen)!,
    });
  }
  return pairs;
}

function diffKeyedChildren(
  leftItems: unknown,
  rightItems: unknown,
  options: {
    noun: string;
    keyFields: string[];
    summarize: (item: Record<string, unknown>) => string;
    valueFields?: string[];
    pathPrefix: string;
  }
): { details: string[]; properties: PropertyChange[] } {
  const leftMap = new Map<string, Record<string, unknown>>();
  const rightMap = new Map<string, Record<string, unknown>>();
  for (const item of asArray(leftItems)) {
    const row = item as Record<string, unknown>;
    leftMap.set(childKey(row, options.keyFields), row);
  }
  for (const item of asArray(rightItems)) {
    const row = item as Record<string, unknown>;
    rightMap.set(childKey(row, options.keyFields), row);
  }

  const details: string[] = [];
  const properties: PropertyChange[] = [];

  const isAssignmentItems =
    options.pathPrefix === "assignmentItems" ||
    options.pathPrefix.endsWith(".assignmentItems");

  const leftOnly = new Map<string, Record<string, unknown>>();
  const rightOnly = new Map<string, Record<string, unknown>>();
  const sharedKeys: string[] = [];
  for (const [key, l] of leftMap) {
    if (rightMap.has(key)) {
      sharedKeys.push(key);
    } else {
      leftOnly.set(key, l);
    }
  }
  for (const [key, r] of rightMap) {
    if (!leftMap.has(key)) {
      rightOnly.set(key, r);
    }
  }

  if (isAssignmentItems) {
    for (const {
      oldKey,
      newKey,
      left: l,
      right: r,
    } of pairAssignmentRetargets(leftOnly, rightOnly)) {
      leftOnly.delete(oldKey);
      rightOnly.delete(newKey);
      details.push(
        `Field assignment retargeted: \`${formatValue(l.assignToReference)}\` → \`${formatValue(r.assignToReference)}\` = ${formatValue(l.value)}`
      );
      properties.push({
        path: `${options.pathPrefix}.${oldKey}→${newKey}.assignToReference`,
        left: options.summarize(l),
        right: options.summarize(r),
      });
    }
  }

  for (const [key, l] of [...leftOnly.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    details.push(`${options.noun} removed: ${options.summarize(l)}`);
    properties.push({
      path: `${options.pathPrefix}.${key}`,
      left: options.summarize(l),
      right: "—",
    });
  }
  for (const [key, r] of [...rightOnly.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    details.push(`${options.noun} added: ${options.summarize(r)}`);
    properties.push({
      path: `${options.pathPrefix}.${key}`,
      left: "—",
      right: options.summarize(r),
    });
  }

  for (const key of sharedKeys.sort()) {
    const l = leftMap.get(key)!;
    const r = rightMap.get(key)!;
    if (stableStringify(l) === stableStringify(r)) {
      continue;
    }
    const fieldChanges: string[] = [];
    for (const field of options.valueFields ?? []) {
      const lv = l[field];
      const rv = r[field];
      if (stableStringify(lv) !== stableStringify(rv)) {
        fieldChanges.push(
          `${field}: \`${formatValue(lv)}\` → \`${formatValue(rv)}\``
        );
        properties.push({
          path: `${options.pathPrefix}.${key}.${field}`,
          left: formatValue(lv),
          right: formatValue(rv),
        });
      }
    }
    if (fieldChanges.length > 0) {
      details.push(
        `${options.noun} modified (\`${key}\`): ${fieldChanges.join("; ")}`
      );
    }

    if (isAssignmentItems) {
      // Reorder / non-functional metadata only — ignore beyond valueFields.
      continue;
    }

    // Always deep-diff remaining keys so extras aren't missed when valueFields
    // already differ (or when only nested/non-value fields changed).
    const skip = new Set<string>([
      ...(options.valueFields ?? []),
      ...options.keyFields,
    ]);
    const lRest: Record<string, unknown> = {};
    const rRest: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      if (skip.has(k)) {
        continue;
      }
      if (stableStringify(l[k]) !== stableStringify(r[k])) {
        lRest[k] = l[k];
        rRest[k] = r[k];
      }
    }
    const beforeProps = properties.length;
    if (Object.keys(lRest).length || Object.keys(rRest).length) {
      deepDiffValues(
        lRest,
        rRest,
        `${options.pathPrefix}.${key}`,
        details,
        properties
      );
    } else if (fieldChanges.length === 0) {
      // Nothing nested to expand — keep a summary row when text differs.
      const leftSum = options.summarize(l);
      const rightSum = options.summarize(r);
      if (leftSum !== rightSum) {
        details.push(`${options.noun} modified: ${rightSum}`);
        properties.push({
          path: `${options.pathPrefix}.${key}`,
          left: leftSum,
          right: rightSum,
        });
      }
    }
    void beforeProps;
  }
  return { details, properties };
}

/** Last segment of assignToReference (field API name). */
function assignmentFieldLeaf(ref: unknown): string {
  const raw = typeof ref === "string" ? ref : String(ref ?? "");
  const i = raw.lastIndexOf(".");
  return i >= 0 ? raw.slice(i + 1) : raw;
}

/** Variable / record prefix before the field leaf. */
function assignmentFieldPrefix(ref: unknown): string {
  const raw = typeof ref === "string" ? ref : String(ref ?? "");
  const i = raw.lastIndexOf(".");
  return i >= 0 ? raw.slice(0, i) : "";
}

function camelCaseTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1\0$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\0$2")
    .split(/[\0_\s.-]+/)
    .filter(Boolean);
}

/** Strip get/Id/Record noise so GetSAId and SARecord both → "sa". */
function normalizeAssignmentVarStem(prefix: string): string {
  let s = prefix.trim();
  s = s.replace(/^(get|set|fetch|load|find)/i, "");
  s = s.replace(/(Records?|Ids?|Objs?|Objects?|Vars?|Variables?)$/i, "");
  return s.toLowerCase();
}

const ASSIGNMENT_PREFIX_NOISE = /^(get|set|fetch|load|find|record|records|id|ids)$/i;

/**
 * How related two assignment variable prefixes are (GetSAId ↔ SARecord).
 * Higher = more confident retarget. 0 = unrelated.
 */
function assignmentPrefixRelatedness(
  leftPrefix: string,
  rightPrefix: string
): number {
  if (!leftPrefix || !rightPrefix) {
    return 0;
  }
  if (leftPrefix.toLowerCase() === rightPrefix.toLowerCase()) {
    return 100;
  }

  const stemA = normalizeAssignmentVarStem(leftPrefix);
  const stemB = normalizeAssignmentVarStem(rightPrefix);
  if (stemA && stemB) {
    if (stemA === stemB) {
      return 100;
    }
    if (stemA.includes(stemB) || stemB.includes(stemA)) {
      return 80;
    }
  }

  const tokensA = camelCaseTokens(leftPrefix).filter(
    (t) => !ASSIGNMENT_PREFIX_NOISE.test(t)
  );
  const tokensB = camelCaseTokens(rightPrefix).filter(
    (t) => !ASSIGNMENT_PREFIX_NOISE.test(t)
  );
  const initialsA = tokensA.map((t) => t[0]!.toLowerCase()).join("");
  const initialsB = tokensB.map((t) => t[0]!.toLowerCase()).join("");
  if (stemB && initialsA === stemB) {
    return 70;
  }
  if (stemA && initialsB === stemA) {
    return 70;
  }
  if (initialsA && initialsA === initialsB) {
    return 60;
  }

  const setB = new Set(tokensB.map((t) => t.toLowerCase()));
  let shared = 0;
  for (const t of tokensA) {
    if (setB.has(t.toLowerCase())) {
      shared++;
    }
  }
  return shared > 0 ? 20 * shared : 0;
}

const ASSIGNMENT_PREFIX_MIN_SCORE = 50;
const ASSIGNMENT_PREFIX_MARGIN = 10;

/**
 * Pair removed↔added assignment items when only the target variable changes:
 * same field leaf, operator, and value. When multiple candidates share that
 * fingerprint, pick by variable-prefix relatedness (GetSAId ↔ SARecord).
 */
function pairAssignmentRetargets(
  leftOnly: Map<string, Record<string, unknown>>,
  rightOnly: Map<string, Record<string, unknown>>
): Array<{
  oldKey: string;
  newKey: string;
  left: Record<string, unknown>;
  right: Record<string, unknown>;
}> {
  const fingerprint = (item: Record<string, unknown>): string =>
    stableStringify({
      operator: item.operator ?? null,
      value: item.value ?? null,
      leaf: assignmentFieldLeaf(item.assignToReference),
    });

  const pairs: Array<{
    oldKey: string;
    newKey: string;
    left: Record<string, unknown>;
    right: Record<string, unknown>;
  }> = [];
  const usedRight = new Set<string>();
  const usedLeft = new Set<string>();

  const tryPair = (
    oldKey: string,
    newKey: string,
    left: Record<string, unknown>,
    right: Record<string, unknown>
  ) => {
    usedLeft.add(oldKey);
    usedRight.add(newKey);
    pairs.push({ oldKey, newKey, left, right });
  };

  // Pass 1: unique fingerprint match (no ambiguity).
  for (const [oldKey, left] of [...leftOnly.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const fp = fingerprint(left);
    const candidates = [...rightOnly.entries()].filter(
      ([newKey, right]) =>
        !usedRight.has(newKey) && fingerprint(right) === fp
    );
    if (candidates.length === 1) {
      const [newKey, right] = candidates[0];
      tryPair(oldKey, newKey, left, right);
    }
  }

  // Pass 2: ambiguous fingerprint — choose by prefix relatedness.
  for (const [oldKey, left] of [...leftOnly.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (usedLeft.has(oldKey)) {
      continue;
    }
    const fp = fingerprint(left);
    const leftPrefix = assignmentFieldPrefix(left.assignToReference);
    const scored = [...rightOnly.entries()]
      .filter(
        ([newKey, right]) =>
          !usedRight.has(newKey) && fingerprint(right) === fp
      )
      .map(([newKey, right]) => ({
        newKey,
        right,
        score: assignmentPrefixRelatedness(
          leftPrefix,
          assignmentFieldPrefix(right.assignToReference)
        ),
      }))
      .sort((a, b) => b.score - a.score || a.newKey.localeCompare(b.newKey));

    if (scored.length === 0) {
      continue;
    }
    const best = scored[0];
    const second = scored[1];
    const clearWinner =
      best.score >= ASSIGNMENT_PREFIX_MIN_SCORE &&
      (!second || best.score >= second.score + ASSIGNMENT_PREFIX_MARGIN);
    if (clearWinner) {
      tryPair(oldKey, best.newKey, left, best.right);
    }
  }

  return pairs;
}

function deepDiffValues(
  left: unknown,
  right: unknown,
  path: string,
  details: string[],
  properties: PropertyChange[]
): void {
  if (stableStringify(left) === stableStringify(right)) {
    return;
  }

  const leftObj = left && typeof left === "object" && !Array.isArray(left);
  const rightObj = right && typeof right === "object" && !Array.isArray(right);
  const leftArr = Array.isArray(left);
  const rightArr = Array.isArray(right);

  if (leftObj && rightObj) {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
    for (const key of [...keys].sort()) {
      if (
        key === "locationX" ||
        key === "locationY" ||
        key === "processMetadataValues"
      ) {
        continue;
      }
      const childPath = path ? `${path}.${key}` : key;
      if (key === "assignmentItems") {
        deepDiffAssignmentItems(l[key], r[key], childPath, details, properties);
        continue;
      }
      deepDiffValues(l[key], r[key], childPath, details, properties);
    }
    return;
  }

  if (leftArr && rightArr) {
    if (path === "assignmentItems" || path.endsWith(".assignmentItems")) {
      deepDiffAssignmentItems(left, right, path, details, properties);
      return;
    }
    const lArr = left as unknown[];
    const rArr = right as unknown[];
    const lMaps = tryKeyedMaps(lArr);
    const rMaps = tryKeyedMaps(rArr);
    if (lMaps && rMaps) {
      const keys = new Set([...lMaps.keys(), ...rMaps.keys()]);
      for (const key of [...keys].sort()) {
        const childPath = path ? `${path}.${key}` : key;
        deepDiffValues(lMaps.get(key), rMaps.get(key), childPath, details, properties);
      }
      return;
    }
    const max = Math.max(lArr.length, rArr.length);
    for (let i = 0; i < max; i++) {
      deepDiffValues(
        lArr[i],
        rArr[i],
        `${path}[${i}]`,
        details,
        properties
      );
    }
    return;
  }

  details.push(
    `\`${path || "(root)"}\` changed: \`${formatValue(left)}\` → \`${formatValue(right)}\``
  );
  properties.push({
    path: path || "(root)",
    left: formatValue(left),
    right: formatValue(right),
  });
}

/**
 * Assignments: ignore reorder-only. Report only added / removed items,
 * operator/value changes for the same assignToReference, and retargets
 * (same field leaf + value, different variable prefix).
 */
function deepDiffAssignmentItems(
  left: unknown,
  right: unknown,
  path: string,
  details: string[],
  properties: PropertyChange[]
): void {
  const child = diffKeyedChildren(left, right, {
    noun: "Field assignment",
    keyFields: ["assignToReference"],
    valueFields: ["operator", "value"],
    pathPrefix: path,
    summarize: (item) =>
      `\`${formatValue(item.assignToReference)}\` = ${formatValue(item.value)}`,
  });
  details.push(...child.details);
  properties.push(...child.properties);
}

/** Prefer name / field / assignToReference keys when deep-diffing arrays. */
function tryKeyedMaps(
  items: unknown[]
): Map<string, Record<string, unknown>> | undefined {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }
    const obj = item as Record<string, unknown>;
    const key = String(
      obj.name ?? obj.field ?? obj.assignToReference ?? obj.key ?? ""
    );
    if (!key || map.has(key)) {
      return undefined;
    }
    map.set(key, obj);
  }
  return map.size > 0 ? map : undefined;
}

function describeElementDiff(
  kind: FlowElementKind,
  leftRaw: Record<string, unknown>,
  rightRaw: Record<string, unknown>
): { details: string[]; properties: PropertyChange[] } {
  const details: string[] = [];
  const properties: PropertyChange[] = [];

  const push = (path: string, left: unknown, right: unknown, detail: string) => {
    details.push(detail);
    properties.push({
      path,
      left: formatValue(left),
      right: formatValue(right),
    });
  };

  for (const prop of TRACKED_SCALAR_PROPS) {
    if (prop === "name") {
      continue;
    }
    const lv = leftRaw[prop];
    const rv = rightRaw[prop];
    if (lv === undefined && rv === undefined) {
      continue;
    }
    if (stableStringify(lv) !== stableStringify(rv)) {
      const nice =
        prop === "label"
          ? "Label"
          : prop === "fieldText"
            ? "Field text"
            : prop;
      push(
        prop,
        lv,
        rv,
        `${nice} changed: \`${formatValue(lv)}\` → \`${formatValue(rv)}\``
      );
    }
  }

  const leftConnector = (leftRaw.connector as Record<string, unknown> | undefined)
    ?.targetReference;
  const rightConnector = (
    rightRaw.connector as Record<string, unknown> | undefined
  )?.targetReference;
  if (stableStringify(leftConnector) !== stableStringify(rightConnector)) {
    push(
      "connector.targetReference",
      leftConnector,
      rightConnector,
      `Next connector changed: \`${formatValue(leftConnector)}\` → \`${formatValue(rightConnector)}\``
    );
  }

  const leftDefault = (
    leftRaw.defaultConnector as Record<string, unknown> | undefined
  )?.targetReference;
  const rightDefault = (
    rightRaw.defaultConnector as Record<string, unknown> | undefined
  )?.targetReference;
  if (stableStringify(leftDefault) !== stableStringify(rightDefault)) {
    push(
      "defaultConnector.targetReference",
      leftDefault,
      rightDefault,
      `Default connector changed: \`${formatValue(leftDefault)}\` → \`${formatValue(rightDefault)}\``
    );
  }

  if (kind === "assignments" || leftRaw.assignmentItems || rightRaw.assignmentItems) {
    const child = diffKeyedChildren(leftRaw.assignmentItems, rightRaw.assignmentItems, {
      noun: "Field assignment",
      keyFields: ["assignToReference"],
      valueFields: ["operator", "value"],
      pathPrefix: "assignmentItems",
      summarize: (item) =>
        `\`${formatValue(item.assignToReference)}\` = ${formatValue(item.value)}`,
    });
    details.push(...child.details);
    properties.push(...child.properties);
  }

  if (kind === "screens" || leftRaw.fields || rightRaw.fields) {
    const leftFields = flattenScreenFields(leftRaw.fields);
    const rightFields = flattenScreenFields(rightRaw.fields);

    const leftOnly = new Map<string, Record<string, unknown>>();
    const rightOnly = new Map<string, Record<string, unknown>>();
    const sharedKeys = new Set<string>();
    for (const [key, l] of leftFields) {
      if (rightFields.has(key)) {
        sharedKeys.add(key);
      } else {
        leftOnly.set(key, l);
      }
    }
    for (const [key, r] of rightFields) {
      if (!leftFields.has(key)) {
        rightOnly.set(key, r);
      }
    }

    const renames = pairSameScreenFieldRenames(leftOnly, rightOnly);
    for (const { oldName, newName, left: l, right: r } of renames) {
      leftOnly.delete(oldName);
      rightOnly.delete(newName);
      push(
        `fields.${oldName}→${newName}.name`,
        oldName,
        newName,
        `Screen field renamed: \`${oldName}\` → \`${newName}\``
      );
      if (stableStringify(l.fieldText) !== stableStringify(r.fieldText)) {
        push(
          `fields.${newName}.fieldText`,
          l.fieldText,
          r.fieldText,
          `Screen field label after rename (\`${newName}\`): \`${formatValue(l.fieldText)}\` → \`${formatValue(r.fieldText)}\``
        );
      }
      // Keep every other body difference (isRequired, visibility, inputs, …).
      const lBody = { ...l };
      const rBody = { ...r };
      for (const k of [
        "name",
        "fieldText",
        "locationX",
        "locationY",
        "__screenPath",
        "fields",
        "processMetadataValues",
      ]) {
        delete lBody[k];
        delete rBody[k];
      }
      if (stableStringify(lBody) !== stableStringify(rBody)) {
        deepDiffValues(
          lBody,
          rBody,
          `fields.${newName}`,
          details,
          properties
        );
      }
    }

    for (const [key, l] of [...leftOnly.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      push(
        `fields.${key}`,
        summarizeScreenFieldBrief(l),
        "—",
        `Screen field removed: \`${key}\`${
          l.fieldText || l.extensionName
            ? ` (${summarizeScreenFieldBrief(l)})`
            : ""
        }`
      );
    }
    for (const [key, r] of [...rightOnly.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      push(
        `fields.${key}`,
        "—",
        summarizeScreenFieldBrief(r),
        `Screen field added: \`${key}\`${
          r.fieldText || r.extensionName
            ? ` (${summarizeScreenFieldBrief(r)})`
            : ""
        }`
      );
    }

    for (const key of [...sharedKeys].sort()) {
      const l = leftFields.get(key)!;
      const r = rightFields.get(key)!;
      if (stableStringify(l) === stableStringify(r)) {
        continue;
      }
      const bits: string[] = [];
      const knownProps = [
        "fieldText",
        "fieldType",
        "isRequired",
        "isReadOnly",
        "choiceReferences",
        "extensionName",
      ] as const;
      for (const prop of knownProps) {
        if (stableStringify(l[prop]) !== stableStringify(r[prop])) {
          const label = prop === "extensionName" ? "elementType" : prop;
          bits.push(
            `${label}: \`${formatValue(l[prop])}\` → \`${formatValue(r[prop])}\``
          );
          properties.push({
            path: `fields.${key}.${label}`,
            left: formatValue(l[prop]),
            right: formatValue(r[prop]),
          });
        }
      }
      const before = details.length;
      // List every other nested difference on the field (visibility, inputs, etc.).
      const skip = new Set<string>(knownProps);
      const lRest: Record<string, unknown> = {};
      const rRest: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (
          skip.has(k) ||
          k === "name" ||
          k === "locationX" ||
          k === "locationY" ||
          k === "processMetadataValues" ||
          k === "fields" ||
          k === "__screenPath"
        ) {
          continue;
        }
        if (stableStringify(l[k]) !== stableStringify(r[k])) {
          lRest[k] = l[k];
          rRest[k] = r[k];
        }
      }
      if (Object.keys(lRest).length || Object.keys(rRest).length) {
        deepDiffValues(lRest, rRest, `fields.${key}`, details, properties);
      }
      if (bits.length) {
        details.push(
          `Screen field modified (\`${key}\`): ${bits.join("; ")}`
        );
      } else if (details.length === before) {
        const lCopy = { ...l };
        const rCopy = { ...r };
        delete lCopy.fields;
        delete rCopy.fields;
        delete lCopy.__screenPath;
        delete rCopy.__screenPath;
        if (stableStringify(lCopy) !== stableStringify(rCopy)) {
          deepDiffValues(lCopy, rCopy, `fields.${key}`, details, properties);
        }
      }
    }
  }

  if (kind === "decisions" || leftRaw.rules || rightRaw.rules) {
    const child = diffKeyedChildren(leftRaw.rules, rightRaw.rules, {
      noun: "Decision outcome",
      keyFields: ["name"],
      valueFields: ["label", "conditionLogic"],
      pathPrefix: "rules",
      summarize: (item) => {
        const target = (item.connector as Record<string, unknown> | undefined)
          ?.targetReference;
        return `\`${formatValue(item.name)}\` → ${formatValue(target)}`;
      },
    });
    details.push(...child.details);
    properties.push(...child.properties);
    // Catch nested condition / connector differences not covered by valueFields.
    const leftRules = new Map(
      asArray(leftRaw.rules).map((item) => {
        const row = item as Record<string, unknown>;
        return [String(row.name ?? ""), row] as const;
      })
    );
    const rightRules = new Map(
      asArray(rightRaw.rules).map((item) => {
        const row = item as Record<string, unknown>;
        return [String(row.name ?? ""), row] as const;
      })
    );
    for (const name of [...new Set([...leftRules.keys(), ...rightRules.keys()])].sort()) {
      if (!name || !leftRules.has(name) || !rightRules.has(name)) {
        continue;
      }
      const l = { ...leftRules.get(name)! };
      const r = { ...rightRules.get(name)! };
      delete l.label;
      delete r.label;
      delete l.conditionLogic;
      delete r.conditionLogic;
      delete l.name;
      delete r.name;
      if (stableStringify(l) !== stableStringify(r)) {
        deepDiffValues(l, r, `rules.${name}`, details, properties);
      }
    }
  }

  for (const [prop, noun, keys, values] of [
    ["inputAssignments", "Input assignment", ["field"], ["value"]] as const,
    ["filters", "Filter", ["field"], ["operator", "value"]] as const,
    ["inputParameters", "Input parameter", ["name"], ["value"]] as const,
    [
      "outputParameters",
      "Output parameter",
      ["name"],
      ["assignToReference"],
    ] as const,
  ]) {
    if (leftRaw[prop] != null || rightRaw[prop] != null) {
      const child = diffKeyedChildren(leftRaw[prop], rightRaw[prop], {
        noun,
        keyFields: [...keys],
        valueFields: [...values],
        pathPrefix: prop,
        summarize: (item) => {
          const id = keys.map((k) => formatValue(item[k])).join(".");
          const valKey = values[0];
          return `\`${id}\`${valKey ? ` = ${formatValue(item[valKey])}` : ""}`;
        },
      });
      details.push(...child.details);
      properties.push(...child.properties);
    }
  }

  const ignored = new Set<string>([
    ...TRACKED_SCALAR_PROPS,
    "locationX",
    "locationY",
    "connector",
    "defaultConnector",
    "assignmentItems",
    "fields",
    "rules",
    "inputAssignments",
    "filters",
    "inputParameters",
    "outputParameters",
    "processMetadataValues",
    "name",
  ]);
  const allKeys = new Set([...Object.keys(leftRaw), ...Object.keys(rightRaw)]);
  for (const key of [...allKeys].sort()) {
    if (ignored.has(key)) {
      continue;
    }
    if (stableStringify(leftRaw[key]) !== stableStringify(rightRaw[key])) {
      if (leftRaw[key] == null) {
        push(key, "—", rightRaw[key], `Property added: \`${key}\``);
      } else if (rightRaw[key] == null) {
        push(key, leftRaw[key], "—", `Property removed: \`${key}\``);
      } else if (
        typeof leftRaw[key] === "object" ||
        typeof rightRaw[key] === "object"
      ) {
        deepDiffValues(leftRaw[key], rightRaw[key], key, details, properties);
      } else {
        push(
          key,
          leftRaw[key],
          rightRaw[key],
          `Property \`${key}\` changed: \`${formatValue(leftRaw[key])}\` → \`${formatValue(rightRaw[key])}\``
        );
      }
    }
  }

  // Always deep-diff the whole element and merge any property paths not already
  // emitted — guarantees the canvas never hides a real nested change.
  const seen = new Set(properties.map((p) => p.path));
  const announcedScreenFields = new Set<string>();
  for (const p of properties) {
    const m = p.path.match(/^fields\.([^.\[]+)$/);
    if (m && (p.left === "—" || p.right === "—")) {
      announcedScreenFields.add(m[1]);
    }
  }
  const extraDetails: string[] = [];
  const extraProperties: PropertyChange[] = [];
  deepDiffValues(leftRaw, rightRaw, "", extraDetails, extraProperties);
  for (const p of extraProperties) {
    if (seen.has(p.path)) {
      continue;
    }
    // Parent row is redundant when a more specific child already exists.
    if (
      [...seen].some(
        (s) => s.startsWith(`${p.path}.`) || s.startsWith(`${p.path}[`)
      )
    ) {
      continue;
    }
    if (
      /(^|\.)location[XY]$/.test(p.path) ||
      /(^|\.)processMetadataValues(\.|$)/.test(p.path)
    ) {
      continue;
    }
    // Nested dump / child props of a field we already reported as add/remove.
    if (
      [...announcedScreenFields].some(
        (f) =>
          p.path === `fields.${f}` ||
          p.path.endsWith(`.fields.${f}`) ||
          p.path.includes(`.fields.${f}.`) ||
          p.path.startsWith(`fields.${f}.`)
      )
    ) {
      continue;
    }
    properties.push(p);
    seen.add(p.path);
  }

  return { details, properties: pruneNoiseProperties(properties, { kind }) };
}

/**
 * When an element is removed and another added, treat as rename only when
 * evidence is strong (exact body match without `name`, or label match PLUS
 * strong structural overlap). Label-only matches are NOT renames — that
 * destroys trust.
 *
 * Choices are special: Salesforce usually mirrors the API name in
 * `value.stringValue`, so a rename changes both `name` and value. We strip
 * that mirrored value before comparing bodies, and treat case-only API
 * renames (Customer_Request → Customer_request) as rename-like.
 */
function detectRenames(
  changes: ElementChange[],
  left: FlowSnapshot,
  right: FlowSnapshot
): ElementChange[] {
  const removed = changes.filter((c) => c.change === "removed");
  const added = changes.filter((c) => c.change === "added");
  if (removed.length === 0 || added.length === 0) {
    return changes;
  }

  const usedRemoved = new Set<string>();
  const usedAdded = new Set<string>();
  const renames: ElementChange[] = [];

  for (const rem of removed) {
    const leftEl = left.elements.get(`${rem.kind}:${rem.name}`);
    if (!leftEl) {
      continue;
    }

    let best: { add: ElementChange; score: number } | undefined;
    for (const add of added) {
      if (add.kind !== rem.kind || usedAdded.has(add.name)) {
        continue;
      }
      const rightEl = right.elements.get(`${add.kind}:${add.name}`);
      if (!rightEl) {
        continue;
      }

      let score = 0;
      const labelMatch =
        !!leftEl.label &&
        !!rightEl.label &&
        leftEl.label.toLowerCase() === rightEl.label.toLowerCase();
      if (labelMatch) {
        score += 2;
      }

      const leftBody = bodyForRenameCompare(leftEl.raw, rem.name, rem.kind);
      const rightBody = bodyForRenameCompare(rightEl.raw, add.name, add.kind);
      if (stableStringify(leftBody) === stableStringify(rightBody)) {
        score += 6; // decisive
      } else {
        const leftAssign = new Set(
          asArray(leftBody.assignmentItems).map((i) =>
            String((i as Record<string, unknown>).assignToReference ?? "")
          )
        );
        const rightAssign = new Set(
          asArray(rightBody.assignmentItems).map((i) =>
            String((i as Record<string, unknown>).assignToReference ?? "")
          )
        );
        let overlap = 0;
        for (const a of leftAssign) {
          if (a && rightAssign.has(a)) {
            overlap++;
          }
        }
        if (
          leftAssign.size > 0 &&
          overlap === leftAssign.size &&
          overlap === rightAssign.size
        ) {
          score += 3;
        }

        const leftConn = (
          leftBody.connector as Record<string, unknown> | undefined
        )?.targetReference;
        const rightConn = (
          rightBody.connector as Record<string, unknown> | undefined
        )?.targetReference;
        if (
          leftConn != null &&
          rightConn != null &&
          String(leftConn) === String(rightConn)
        ) {
          score += 1;
        }

        // Screen field-name overlap
        if (rem.kind === "screens") {
          const leftFields = new Set(
            asArray(leftBody.fields).map((f) =>
              String((f as Record<string, unknown>).name ?? "")
            )
          );
          const rightFields = new Set(
            asArray(rightBody.fields).map((f) =>
              String((f as Record<string, unknown>).name ?? "")
            )
          );
          let fieldOverlap = 0;
          for (const n of leftFields) {
            if (n && rightFields.has(n)) {
              fieldOverlap++;
            }
          }
          if (
            leftFields.size > 0 &&
            fieldOverlap === leftFields.size &&
            fieldOverlap === rightFields.size
          ) {
            score += 3;
          }
        }
      }

      // Choice / resource API renames (incl. case-only) with same choice text.
      if (rem.kind === "choices") {
        if (namesAreCaseVariant(rem.name, add.name)) {
          score += 4;
        } else if (namesLookLikeFieldRename(rem.name, add.name)) {
          score += 3;
        }
        const leftText = String(
          leftEl.raw.choiceText ?? leftEl.label ?? ""
        ).toLowerCase();
        const rightText = String(
          rightEl.raw.choiceText ?? rightEl.label ?? ""
        ).toLowerCase();
        if (leftText && leftText === rightText) {
          score += 2;
        }
      }

      // Require strong evidence: exact body OR (label + structural overlap).
      // Choices: case-only API rename with matching text is enough.
      const strongEnough =
        score >= 6 ||
        (labelMatch && score >= 5) ||
        (rem.kind === "choices" &&
          namesAreCaseVariant(rem.name, add.name) &&
          score >= 4);
      if (strongEnough && (!best || score > best.score)) {
        best = { add, score };
      }
    }

    if (best) {
      usedRemoved.add(rem.name);
      usedAdded.add(best.add.name);
      const leftEl2 = left.elements.get(`${rem.kind}:${rem.name}`)!;
      const rightEl2 = right.elements.get(`${best.add.kind}:${best.add.name}`)!;
      const leftBody = bodyForRenameCompare(leftEl2.raw, rem.name, rem.kind);
      const rightBody = bodyForRenameCompare(
        rightEl2.raw,
        best.add.name,
        best.add.kind
      );
      const bodyDiff = describeElementDiff(rem.kind, leftBody, rightBody);
      const bodyDetails = bodyDiff.details.filter(
        (d) => !d.startsWith("API name")
      );
      renames.push({
        name: best.add.name,
        previousName: rem.name,
        kind: rem.kind,
        change: "modified",
        leftLabel: rem.leftLabel,
        rightLabel: best.add.rightLabel,
        details: [
          `API name changed: \`${rem.name}\` → \`${best.add.name}\``,
          ...bodyDetails,
        ],
        properties: pruneNoiseProperties(
          [
            {
              path: "name",
              left: rem.name,
              right: best.add.name,
            },
            ...bodyDiff.properties,
          ],
          {
            kind: rem.kind,
            previousName: rem.name,
            name: best.add.name,
          }
        ),
      });
    }
  }

  return [
    ...renames,
    ...changes.filter(
      (c) =>
        !(c.change === "removed" && usedRemoved.has(c.name)) &&
        !(c.change === "added" && usedAdded.has(c.name))
    ),
  ];
}

/** Case-only API rename: Customer_Request ↔ Customer_request. */
function namesAreCaseVariant(a: string, b: string): boolean {
  return a !== b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Body used for rename matching. For choices, ignore `value.stringValue` when
 * it merely mirrors the choice API name (common Salesforce pattern).
 */
function bodyForRenameCompare(
  raw: Record<string, unknown>,
  apiName: string,
  kind: FlowElementKind
): Record<string, unknown> {
  const body = { ...raw };
  delete body.name;
  if (kind === "choices" && body.value && typeof body.value === "object") {
    const value = { ...(body.value as Record<string, unknown>) };
    if (String(value.stringValue ?? "") === apiName) {
      delete value.stringValue;
    }
    body.value = value;
  }
  return body;
}

export function parseFlowXml(
  xml: string,
  options?: boolean | NoiseOptions
): FlowSnapshot {
  const noise = resolveNoise(options);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => (ARRAY_TAGS as readonly string[]).includes(name),
  });

  const doc = parser.parse(xml) as { Flow?: Record<string, unknown> };
  const flow = doc.Flow ?? {};

  const elements = new Map<string, FlowElementSnapshot>();

  const ingest = (kind: FlowElementKind, raw: unknown) => {
    for (const entry of asArray(raw)) {
      const item = entry as Record<string, unknown>;
      const name = String(item.name ?? "");
      if (!name) {
        continue;
      }
      const cleaned = stripNoise(item, noise) as Record<string, unknown>;
      elements.set(`${kind}:${name}`, {
        kind,
        name,
        label: item.label != null ? String(item.label) : undefined,
        fingerprint: stableStringify(cleaned),
        raw: cleaned,
      });
    }
  };

  for (const kind of ELEMENT_COLLECTIONS) {
    ingest(kind, flow[kind]);
  }
  for (const kind of RESOURCE_COLLECTIONS) {
    ingest(kind, flow[kind]);
  }

  if (flow.start) {
    const cleaned = stripNoise(flow.start, noise) as Record<string, unknown>;
    elements.set("start:start", {
      kind: "start",
      name: "start",
      label: "Start",
      fingerprint: stableStringify(cleaned),
      raw: cleaned,
    });
  }

  return {
    apiName:
      flow.fullName != null
        ? String(flow.fullName)
        : flow.interviewLabel != null
          ? String(flow.interviewLabel)
          : undefined,
    label: flow.label != null ? String(flow.label) : undefined,
    processType:
      flow.processType != null ? String(flow.processType) : undefined,
    status: flow.status != null ? String(flow.status) : undefined,
    interviewLabel:
      flow.interviewLabel != null ? String(flow.interviewLabel) : undefined,
    elements,
  };
}

export function diffFlowSnapshots(
  left: FlowSnapshot,
  right: FlowSnapshot
): FlowDiffResult {
  const changes: ElementChange[] = [];
  const allKeys = new Set([...left.elements.keys(), ...right.elements.keys()]);

  for (const key of allKeys) {
    const l = left.elements.get(key);
    const r = right.elements.get(key);
    if (l && !r) {
      changes.push({
        name: l.name,
        kind: l.kind,
        change: "removed",
        leftLabel: l.label,
        details: [],
        properties: [],
      });
    } else if (!l && r) {
      changes.push({
        name: r.name,
        kind: r.kind,
        change: "added",
        rightLabel: r.label,
        details: [],
        properties: [],
      });
    } else if (l && r && l.fingerprint !== r.fingerprint) {
      const described = describeElementDiff(l.kind, l.raw, r.raw);
      changes.push({
        name: l.name,
        kind: l.kind,
        change: "modified",
        leftLabel: l.label,
        rightLabel: r.label,
        details: described.details,
        properties: described.properties,
      });
    }
  }

  const withRenames = detectRenames(changes, left, right);
  const withMoves = detectScreenFieldMoves(withRenames, left, right);
  const withFlowMeta = [...withMoves, ...diffFlowMetadata(left, right)];

  const cleaned = withFlowMeta.map((c) => ({
    ...c,
    properties: pruneNoiseProperties(c.properties, {
      kind: c.kind,
      previousName: c.previousName,
      name: c.name,
    }),
  }));

  cleaned.sort((a, b) => {
    if (a.change !== b.change) {
      const order = { added: 0, removed: 1, modified: 2 };
      return order[a.change] - order[b.change];
    }
    return a.name.localeCompare(b.name);
  });

  return {
    left,
    right,
    changes: cleaned,
    processTypeChanged:
      (left.processType || "") !== (right.processType || ""),
  };
}

/** Flow-level scalars (status/label/…) as canvas rows so nothing is missed. */
function diffFlowMetadata(
  left: FlowSnapshot,
  right: FlowSnapshot
): ElementChange[] {
  const properties: PropertyChange[] = [];
  const details: string[] = [];
  const compare = (
    path: string,
    leftVal: string | undefined,
    rightVal: string | undefined,
    label: string
  ) => {
    const l = leftVal ?? "";
    const r = rightVal ?? "";
    if (l === r) {
      return;
    }
    properties.push({
      path,
      left: leftVal ?? "—",
      right: rightVal ?? "—",
    });
    details.push(
      `${label} changed: \`${leftVal ?? "—"}\` → \`${rightVal ?? "—"}\``
    );
  };
  compare("status", left.status, right.status, "Flow status");
  compare("label", left.label, right.label, "Flow label");
  compare(
    "interviewLabel",
    left.interviewLabel,
    right.interviewLabel,
    "Interview label"
  );
  compare("processType", left.processType, right.processType, "Process type");
  if (properties.length === 0) {
    return [];
  }
  return [
    {
      name: "(Flow)",
      kind: "flow",
      change: "modified",
      leftLabel: left.label,
      rightLabel: right.label,
      details,
      properties,
    },
  ];
}

interface ScreenFieldIndex {
  screenName: string;
  screenLabel?: string;
  field: Record<string, unknown>;
  path: string;
}

function indexScreenFieldsByName(
  snap: FlowSnapshot
): Map<string, ScreenFieldIndex> {
  const out = new Map<string, ScreenFieldIndex>();
  for (const el of snap.elements.values()) {
    if (el.kind !== "screens") {
      continue;
    }
    const flat = flattenScreenFields(el.raw.fields);
    for (const [fieldName, field] of flat) {
      // Skip pure layout containers that only nest other fields.
      const hasNested = asArray(field.fields).length > 0;
      const isControl =
        field.extensionName != null ||
        field.fieldType != null ||
        field.fieldText != null ||
        !hasNested;
      if (!isControl && hasNested) {
        continue;
      }
      out.set(fieldName, {
        screenName: el.name,
        screenLabel: el.label,
        field,
        path: String(field.__screenPath ?? fieldName),
      });
    }
  }
  return out;
}

/**
 * When the same screen-field API name leaves one screen and appears on another,
 * report it as a move instead of remove + add.
 */
function detectScreenFieldMoves(
  changes: ElementChange[],
  left: FlowSnapshot,
  right: FlowSnapshot
): ElementChange[] {
  const leftIdx = indexScreenFieldsByName(left);
  const rightIdx = indexScreenFieldsByName(right);
  const moves = new Map<
    string,
    { from: ScreenFieldIndex; to: ScreenFieldIndex }
  >();

  for (const [fieldName, from] of leftIdx) {
    const to = rightIdx.get(fieldName);
    if (to && from.screenName !== to.screenName) {
      moves.set(fieldName, { from, to });
    }
  }
  if (moves.size === 0) {
    return changes;
  }

  const byScreen = new Map<string, ElementChange>();
  for (const c of changes) {
    if (c.kind === "screens") {
      byScreen.set(c.name, { ...c, details: [...c.details], properties: [...c.properties] });
    }
  }

  const ensureScreen = (
    screenName: string,
    side: "from" | "to",
    info: ScreenFieldIndex
  ): ElementChange => {
    let change = byScreen.get(screenName);
    if (!change) {
      change = {
        name: screenName,
        kind: "screens",
        change: "modified",
        leftLabel: side === "from" ? info.screenLabel : undefined,
        rightLabel: side === "to" ? info.screenLabel : undefined,
        details: [],
        properties: [],
      };
      byScreen.set(screenName, change);
    } else if (change.change === "added" || change.change === "removed") {
      // Screen itself added/removed — keep that; still annotate the move.
    } else {
      change.change = "modified";
    }
    return change;
  };

  for (const [fieldName, { from, to }] of moves) {
    const fromChange = ensureScreen(from.screenName, "from", from);
    const toChange = ensureScreen(to.screenName, "to", to);

    const dropFieldNoise = (c: ElementChange) => {
      c.details = c.details.filter(
        (d) =>
          !(
            (d.includes("Screen field removed") ||
              d.includes("Screen field added") ||
              d.includes("Screen field modified")) &&
            d.includes(`\`${fieldName}\``)
          )
      );
      c.properties = c.properties.filter(
        (p) =>
          !(
            p.path === `fields.${fieldName}` ||
            p.path.startsWith(`fields.${fieldName}.`) ||
            p.path.endsWith(`/${fieldName}`) ||
            p.path.includes(`.fields.${fieldName}`)
          )
      );
    };
    dropFieldNoise(fromChange);
    dropFieldNoise(toChange);

    const moveDetail = `Screen field moved: \`${fieldName}\` from \`${from.screenName}\` → \`${to.screenName}\``;
    fromChange.details.push(moveDetail);
    toChange.details.push(moveDetail);
    fromChange.properties.push({
      path: `fields.${fieldName}.screen`,
      left: from.screenName,
      right: to.screenName,
    });
    toChange.properties.push({
      path: `fields.${fieldName}.screen`,
      left: from.screenName,
      right: to.screenName,
    });

    // If field config also changed during the move, list those property diffs once on the destination.
    if (stableStringify(from.field) !== stableStringify(to.field)) {
      const lCopy = { ...from.field };
      const rCopy = { ...to.field };
      delete lCopy.fields;
      delete rCopy.fields;
      delete lCopy.__screenPath;
      delete rCopy.__screenPath;
      delete lCopy.locationX;
      delete rCopy.locationX;
      delete lCopy.locationY;
      delete rCopy.locationY;
      const extraDetails: string[] = [];
      const extraProps: PropertyChange[] = [];
      deepDiffValues(
        lCopy,
        rCopy,
        `fields.${fieldName}`,
        extraDetails,
        extraProps
      );
      toChange.details.push(...extraDetails);
      toChange.properties.push(...extraProps);
    }
  }

  const other = changes.filter((c) => c.kind !== "screens");
  const screens = [...byScreen.values()].filter(
    (c) =>
      c.change === "added" ||
      c.change === "removed" ||
      c.details.length > 0 ||
      c.properties.length > 0
  );
  return [...other, ...screens];
}

export function formatDiffMarkdown(
  diff: FlowDiffResult,
  leftTitle: string,
  rightTitle: string,
  options?: NoiseOptions & {
    ignoreLayoutNoise?: boolean;
    leftVersionLabel?: string;
    rightVersionLabel?: string;
  }
): string {
  const added = diff.changes.filter((c) => c.change === "added");
  const removed = diff.changes.filter((c) => c.change === "removed");
  const modified = diff.changes.filter((c) => c.change === "modified");
  const noise = resolveNoise(options);
  const leftVer = options?.leftVersionLabel || "Baseline";
  const rightVer = options?.rightVersionLabel || "Compare";

  const lines: string[] = [
    `# Data Capture Flow compare`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Baseline | \`${leftTitle}\` |`,
    `| Compare | \`${rightTitle}\` |`,
    `| Process type (left) | ${diff.left.processType ?? "—"} |`,
    `| Process type (right) | ${diff.right.processType ?? "—"} |`,
    `| Status (left) | ${diff.left.status ?? "—"} |`,
    `| Status (right) | ${diff.right.status ?? "—"} |`,
    ``,
  ];

  if (diff.changes.length === 0 && !diff.processTypeChanged) {
    lines.push(
      `**No functional differences** after applying noise filters.`,
      ``,
      `_Layout noise ignored: ${noise.ignoreLayoutNoise ? "yes" : "no"}; processMetadataValues ignored: ${noise.ignoreProcessMetadata ? "yes" : "no"}._`,
      ``
    );
    return lines.join("\n");
  }

  lines.push(
    `**${diff.changes.length}** element/resource change(s): **${added.length}** added, **${removed.length}** removed, **${modified.length}** updated.`,
    ``
  );

  if (diff.processTypeChanged) {
    lines.push(
      `> Process type changed: \`${diff.left.processType}\` → \`${diff.right.processType}\``,
      ``
    );
  }

  const section = (title: string, items: ElementChange[]) => {
    lines.push(`## ${title}`);
    if (items.length === 0) {
      lines.push(`_None_`, ``);
      return;
    }
    for (const item of items) {
      const label = item.rightLabel || item.leftLabel;
      if (item.previousName) {
        lines.push(
          `### \`${item.previousName}\` → \`${item.name}\` (${item.kind})`
        );
      } else {
        const titleBits = [
          `\`${item.name}\``,
          `(${item.kind})`,
          label ? `— ${label}` : undefined,
        ].filter(Boolean);
        lines.push(`### ${titleBits.join(" ")}`);
      }
      if (item.details.length > 0) {
        for (const detail of item.details) {
          lines.push(`- ${detail}`);
        }
      } else if (item.change === "added") {
        lines.push(`- Element added`);
      } else if (item.change === "removed") {
        lines.push(`- Element removed`);
      }
      if (item.properties.length > 0) {
        lines.push(``);
        lines.push(`| Property | ${leftVer} | ${rightVer} |`);
        lines.push(`|---|---|---|`);
        for (const prop of item.properties) {
          lines.push(
            `| \`${prop.path}\` | ${escapeMdCell(prop.left)} | ${escapeMdCell(prop.right)} |`
          );
        }
      }
      lines.push(``);
    }
  };

  section("Added", added);
  section("Removed", removed);
  section("Updated", modified);

  lines.push(
    `---`,
    ``,
    `_Noise filters: layout ${noise.ignoreLayoutNoise ? "ignored" : "included"}; processMetadataValues ${noise.ignoreProcessMetadata ? "ignored" : "included"}._`
  );

  return lines.join("\n");
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
