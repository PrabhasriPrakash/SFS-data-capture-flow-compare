const FLOW_BLOCK_TAGS = [
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
  "variables",
  "constants",
  "formulas",
  "textTemplates",
  "choices",
  "dynamicChoiceSets",
  "stages",
] as const;

export interface LocateOptions {
  /** Flow collection kind, e.g. actionCalls, screens. */
  kind?: string;
  /** Extra API name to try (e.g. previousName on baseline for renames). */
  alternateName?: string;
  /** First property path from the change, e.g. fields.Reason.isRequired */
  propertyPath?: string;
}

export interface LocateResult {
  /** 0-based line index */
  line: number;
  matchedName: string;
  found: boolean;
}

/**
 * Locate an element (and optional nested field) in Flow XML.
 * Prefers the element definition block over incidental <name> matches.
 */
export function findElementLocation(
  xml: string,
  elementName: string,
  options: LocateOptions = {}
): LocateResult {
  const names = uniqueNames([elementName, options.alternateName]);

  if (elementName === "start" || options.kind === "start") {
    const idx = xml.search(/<start\b/);
    if (idx >= 0) {
      return { line: lineAt(xml, idx), matchedName: "start", found: true };
    }
  }

  if (options.kind && options.kind !== "unknown" && options.kind !== "start") {
    for (const name of names) {
      const block = findBlockForName(xml, options.kind, name);
      if (block) {
        return locateInBlock(xml, block, name, options.propertyPath);
      }
    }
  }

  for (const name of names) {
    for (const tag of FLOW_BLOCK_TAGS) {
      const block = findBlockForName(xml, tag, name);
      if (block) {
        return locateInBlock(xml, block, name, options.propertyPath);
      }
    }
  }

  for (const name of names) {
    const plain = findPlainName(xml, name);
    if (plain.found) {
      return plain;
    }
  }

  return { line: 0, matchedName: elementName, found: false };
}

/**
 * Find the 0-based line index of an element by its <name>…</name> API name.
 * @deprecated Prefer findElementLocation for kind-aware jumps.
 */
export function findElementLine(xml: string, elementName: string): number {
  return findElementLocation(xml, elementName).line;
}

function uniqueNames(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const v of values) {
    const n = String(v ?? "").trim();
    if (n && !out.includes(n)) {
      out.push(n);
    }
  }
  return out;
}

function lineAt(xml: string, index: number): number {
  return xml.slice(0, index).split(/\r?\n/).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameTagRe(name: string): RegExp {
  return new RegExp(`<name>\\s*${escapeRegExp(name)}\\s*</name>`, "i");
}

/** Find a top-level <kind>…</kind> block whose first <name> is the element API name. */
function findBlockForName(
  xml: string,
  kind: string,
  name: string
): { start: number; end: number } | undefined {
  const openRe = new RegExp(`<${escapeRegExp(kind)}\\b[^>]*>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(xml)) !== null) {
    const start = match.index;
    const closeTag = `</${kind}>`;
    let end = xml.indexOf(closeTag, start + match[0].length);
    if (end < 0) {
      end = Math.min(xml.length, start + 50_000);
    } else {
      end += closeTag.length;
    }
    const block = xml.slice(start, end);
    const firstName = /<name>\s*([^<]+?)\s*<\/name>/i.exec(block);
    if (firstName && firstName[1].trim() === name) {
      return { start, end };
    }
  }
  return undefined;
}

function locateInBlock(
  xml: string,
  block: { start: number; end: number },
  elementName: string,
  propertyPath?: string
): LocateResult {
  const slice = xml.slice(block.start, block.end);
  const nested = nestedTargetFromPath(propertyPath);
  if (nested) {
    const searchFromName = nameTagRe(elementName).exec(slice);
    const searchFrom = searchFromName
      ? searchFromName.index + searchFromName[0].length
      : 0;
    const rest = slice.slice(searchFrom);
    const nestedName = nameTagRe(nested).exec(rest);
    if (nestedName) {
      const abs = block.start + searchFrom + nestedName.index;
      return { line: lineAt(xml, abs), matchedName: nested, found: true };
    }
    const fieldRe = new RegExp(
      `<field>\\s*${escapeRegExp(nested)}\\s*</field>`,
      "i"
    );
    const fieldMatch = fieldRe.exec(rest);
    if (fieldMatch) {
      const abs = block.start + searchFrom + fieldMatch.index;
      return { line: lineAt(xml, abs), matchedName: nested, found: true };
    }
    const assignRe = new RegExp(
      `<assignToReference>\\s*${escapeRegExp(nested)}\\s*</assignToReference>`,
      "i"
    );
    const assignMatch = assignRe.exec(rest);
    if (assignMatch) {
      const abs = block.start + searchFrom + assignMatch.index;
      return { line: lineAt(xml, abs), matchedName: nested, found: true };
    }
  }

  const self = nameTagRe(elementName).exec(slice);
  if (self) {
    return {
      line: lineAt(xml, block.start + self.index),
      matchedName: elementName,
      found: true,
    };
  }

  // Fall back to the opening tag of the element block
  return {
    line: lineAt(xml, block.start),
    matchedName: elementName,
    found: true,
  };
}

function nestedTargetFromPath(propertyPath?: string): string | undefined {
  if (!propertyPath) {
    return undefined;
  }
  const patterns = [
    /^fields\.([^.]+)/i,
    /^assignmentItems\.([^.]+)/i,
    /^inputAssignments\.([^.]+)/i,
    /^inputParameters\.([^.]+)/i,
    /^outputParameters\.([^.]+)/i,
    /^filters\.([^.]+)/i,
    /^rules\.([^.]+)/i,
    /^conditions\.([^.]+)/i,
  ];
  for (const re of patterns) {
    const m = propertyPath.match(re);
    if (m?.[1]) {
      return m[1];
    }
  }
  return undefined;
}

function findPlainName(xml: string, name: string): LocateResult {
  const re = nameTagRe(name);
  const match = re.exec(xml);
  if (!match) {
    return { line: 0, matchedName: name, found: false };
  }
  return {
    line: lineAt(xml, match.index),
    matchedName: name,
    found: true,
  };
}
