import type { TamperReport } from "./j-client";

export type J3ReportDownloadEnvironment = {
  decodeBase64: (content: string) => Uint8Array;
  createBlob: (bytes: Uint8Array, contentType: string) => Blob;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createLink: () => HTMLAnchorElement;
  appendLink: (link: HTMLAnchorElement) => void;
};

function browserEnvironment(): J3ReportDownloadEnvironment {
  return {
    decodeBase64: (content) => Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
    createBlob: (bytes, contentType) => {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy.buffer], { type: contentType });
    },
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createLink: () => document.createElement("a"),
    appendLink: (link) => document.body.appendChild(link),
  };
}

/**
 * Downloads a report that the server has already generated.
 * This function never calls the report API, so a retry cannot create another report or audit entry.
 */
export function downloadJ3ReportFile(
  report: TamperReport,
  environment: J3ReportDownloadEnvironment = browserEnvironment(),
) {
  const bytes = environment.decodeBase64(report.contentBase64);
  const blob = environment.createBlob(bytes, report.contentType);
  const url = environment.createObjectUrl(blob);
  let link: HTMLAnchorElement | null = null;
  try {
    link = environment.createLink();
    link.href = url;
    link.download = report.filename;
    environment.appendLink(link);
    link.click();
  } finally {
    link?.remove();
    environment.revokeObjectUrl(url);
  }
}
