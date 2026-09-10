import * as fs from "fs";

export class FlowVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowVerificationError";
  }
}

export interface VerifiedFlowFile {
  path: string;
  byteLength: number;
  processType?: string;
  label?: string;
  status?: string;
  hasFlowRoot: boolean;
}

/**
 * Verify a retrieved/local flow file is usable before opening a diff.
 * Never trust CLI success alone — require a real, parseable Flow XML payload.
 */
export function verifyFlowFile(
  filePath: string,
  options?: {
    expectedApiName?: string;
    expectedVersion?: number;
    requireDataCapture?: boolean;
  }
): VerifiedFlowFile {
  if (!filePath) {
    throw new FlowVerificationError("Flow file path is empty.");
  }
  if (!fs.existsSync(filePath)) {
    throw new FlowVerificationError(`Flow file does not exist: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new FlowVerificationError(`Not a file: ${filePath}`);
  }
  if (stat.size < 32) {
    throw new FlowVerificationError(
      `Flow file is too small (${stat.size} bytes) to be valid metadata: ${filePath}`
    );
  }

  const xml = fs.readFileSync(filePath, "utf8");
  if (!/<Flow[\s>]/i.test(xml)) {
    throw new FlowVerificationError(
      `File does not contain a <Flow> root element: ${filePath}`
    );
  }
  if (!/<\/Flow>\s*$/m.test(xml) && !xml.includes("</Flow>")) {
    throw new FlowVerificationError(
      `Flow XML appears truncated (missing </Flow>): ${filePath}`
    );
  }

  const processType = xml.match(/<processType>([^<]+)<\/processType>/)?.[1];
  const label = xml.match(/<label>([^<]+)<\/label>/)?.[1];
  const status = xml.match(/<status>([^<]+)<\/status>/)?.[1];

  if (options?.requireDataCapture && processType !== "DataCaptureFlow") {
    throw new FlowVerificationError(
      `Expected processType DataCaptureFlow but found ${processType ?? "missing"} in ${filePath}`
    );
  }

  if (options?.expectedApiName && options.expectedVersion != null) {
    const base = filePath.replace(/\\/g, "/").split("/").pop() || "";
    const api = options.expectedApiName;
    const ver = options.expectedVersion;
    const accepted =
      base === `${api}.flow-meta.xml` ||
      base === `${api}-${ver}.flow-meta.xml` ||
      base === `${api}-v${ver}.flow-meta.xml` ||
      base.endsWith(`-${api}-${ver}.flow-meta.xml`) ||
      base.endsWith(`-${api}-v${ver}.flow-meta.xml`) ||
      base.includes(`${api}-${ver}`) ||
      base.includes(`${api}-v${ver}`);
    if (!accepted) {
      throw new FlowVerificationError(
        `Retrieved file looks like a different flow (${base}); expected ${api}.`
      );
    }
  }

  return {
    path: filePath,
    byteLength: stat.size,
    processType,
    label,
    status,
    hasFlowRoot: true,
  };
}
