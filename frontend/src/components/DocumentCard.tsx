import { NavLink } from "react-router-dom";
import type { DocumentRecord, Role } from "../types";
import { StatusStamp } from "./StatusStamp";
import { IconCheck } from "./icons";

interface Props {
  doc: DocumentRecord;
  role: Role;
  onDelete: (id: string) => void;
  onToggleApproval: (doc: DocumentRecord) => void;
}

export function DocumentCard({ doc, role, onDelete, onToggleApproval }: Props) {
  const pages = doc.pageCount ? `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}` : "";

  return (
    <NavLink to={`/documents/${doc.id}`} className={({ isActive }) => `doc-card${isActive ? " active" : ""}`}>
      <span className="doc-card-name" title={doc.filename}>
        {doc.filename}
      </span>
      <span className="doc-card-meta">
        <StatusStamp status={doc.status} />
        {pages && <span className="doc-card-pages">{pages}</span>}
      </span>

      {role === "teacher" && (
        <span className="doc-card-actions">
          {doc.status === "ready" && (
            <button
              type="button"
              className={`doc-card-approve${doc.approvedAt ? " approved" : ""}`}
              aria-pressed={Boolean(doc.approvedAt)}
              title={
                doc.approvedAt
                  ? "Students can study from this. Click to withdraw it."
                  : "Students can't see this yet. Click to approve it."
              }
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleApproval(doc);
              }}
            >
              {doc.approvedAt && <IconCheck />}
              {doc.approvedAt ? "Approved" : "Approve"}
            </button>
          )}
          <button
            type="button"
            className="doc-card-delete"
            aria-label={`Delete ${doc.filename}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm(`Delete "${doc.filename}"? This can't be undone.`)) {
                onDelete(doc.id);
              }
            }}
          >
            Remove
          </button>
        </span>
      )}
    </NavLink>
  );
}
