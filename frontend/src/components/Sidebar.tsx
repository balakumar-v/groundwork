import type { DocumentRecord, Role } from "../types";
import { DocumentCard } from "./DocumentCard";
import { UploadDropzone } from "./UploadDropzone";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./BrandMark";
import { IconClose } from "./icons";

interface Props {
  documents: DocumentRecord[];
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  role: Role;
  onToggleApproval: (doc: DocumentRecord) => void;
  uploading: boolean;
  uploadError: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  userEmail: string;
  onLogout: () => void;
  /** Phone-width drawer state; ignored on desktop where the rail is always shown. */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({
  documents,
  onUpload,
  onDelete,
  role,
  onToggleApproval,
  uploading,
  uploadError,
  theme,
  onToggleTheme,
  userEmail,
  onLogout,
  open,
  onClose,
}: Props) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Study material">
      <div className="sidebar-header">
        <Wordmark size={30} />
        <button type="button" className="icon-btn sidebar-close" aria-label="Close menu" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <p className="sidebar-subtitle">
        {role === "teacher" ? "Publish notes your students can trust." : "Ask your teacher's notes anything."}
      </p>

      {role === "teacher" && <UploadDropzone onUpload={onUpload} uploading={uploading} />}
      {uploadError && (
        <p className="upload-error" role="alert">
          {uploadError}
        </p>
      )}

      <h2 className="sidebar-section-title">{role === "teacher" ? "Your notes" : "Study material"}</h2>
      <ul className="sidebar-list">
        {documents.length === 0 && !uploading && (
          <li className="sidebar-empty">
            {role === "teacher"
              ? "Nothing here yet. Upload a PDF to get started."
              : "Nothing approved yet. Ask your teacher to approve some notes."}
          </li>
        )}
        {documents.map((doc) => (
          <li key={doc.id}>
            <DocumentCard doc={doc} role={role} onDelete={onDelete} onToggleApproval={onToggleApproval} />
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <span className="avatar" aria-hidden="true">
          {userEmail.charAt(0).toUpperCase()}
        </span>
        <span className="sidebar-user" title={userEmail}>
          <span className="sidebar-user-email">{userEmail}</span>
          <span className="role-badge">{role}</span>
        </span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button type="button" className="sidebar-logout" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
