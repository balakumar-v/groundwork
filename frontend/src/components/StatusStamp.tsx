import type { DocumentStatus } from "../types";

const LABEL: Record<DocumentStatus, string> = {
  pending: "Queued",
  processing: "Reading…",
  ready: "Ready",
  failed: "Failed",
};

export function StatusStamp({ status }: { status: DocumentStatus }) {
  return (
    <span className="status-stamp" data-status={status}>
      {LABEL[status]}
    </span>
  );
}
