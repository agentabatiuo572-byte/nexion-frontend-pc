export interface F5CsvArtifactMetadata {
  exportId: string;
  rowCount: number;
  byteSize: number;
  expectedSha: string;
  redacted: boolean;
  filename: string;
}

export interface VerifiedF5CsvArtifact {
  sha256: string;
  rowCount: number;
}

const unreadable = (): Error => new Error("F5_EXPORT_ARTIFACT_UNREADABLE");

/** Pure browser/server test seam: no download occurs until every signed receipt field is checked. */
export async function verifyF5CsvArtifact(
  content: ArrayBuffer,
  metadata: F5CsvArtifactMetadata,
): Promise<VerifiedF5CsvArtifact> {
  const { exportId, rowCount, byteSize, expectedSha, redacted, filename } = metadata;
  if (!exportId || !Number.isSafeInteger(rowCount) || rowCount < 0
    || !Number.isSafeInteger(byteSize) || byteSize !== content.byteLength
    || !/^[a-f0-9]{64}$/.test(expectedSha) || !redacted || !filename.endsWith(".csv")
    || !globalThis.crypto?.subtle) {
    throw unreadable();
  }

  let actualSha: string;
  let csv: string;
  try {
    actualSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", content)))
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    // Preserve the decoded U+FEFF so the verifier can prove the server artifact really carried
    // the Excel-safe UTF-8 BOM; TextDecoder strips it unless ignoreBOM is enabled.
    csv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    throw unreadable();
  }
  const lines = csv.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
  if (actualSha !== expectedSha
    || !csv.startsWith("\uFEFF\"commissionId\"")
    || Math.max(0, lines.length - 1) !== rowCount) {
    throw unreadable();
  }
  return { sha256: actualSha, rowCount };
}
