/** Derive a short version label from a flow file name/path. */
export function versionLabelFromPath(filePathOrName: string): string {
  const base = filePathOrName.split(/[/\\]/).pop() || filePathOrName;
  const vDash = base.match(/-v(\d+)(?:\.flow-meta\.xml)?$/i);
  if (vDash) {
    return `v${vDash[1]}`;
  }
  const numbered = base.match(/-(\d+)(?:\.flow-meta\.xml)?$/i);
  if (numbered) {
    return `v${numbered[1]}`;
  }
  return base.replace(/\.flow-meta\.xml$/i, "") || "version";
}
