/** Extract a JSON object from Salesforce CLI stdout (warnings may precede it). */
export function parseSfJson<T = unknown>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Salesforce CLI returned empty output.");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through — try braced payloads in the stream.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("{");
  if (firstBrace < 0) {
    throw new Error(
      "Salesforce CLI did not return JSON. Check `sf` is installed and authenticated."
    );
  }

  for (const start of [firstBrace, lastBrace]) {
    if (start < 0) {
      continue;
    }
    const candidate = trimmed.slice(start);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next
    }
  }

  throw new Error(
    "Could not parse Salesforce CLI JSON output. Try running the same `sf` command in a terminal."
  );
}
