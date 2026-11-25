import type { Role } from "../types";
import { BrandMark } from "./BrandMark";

export function EmptyState({ role }: { role: Role }) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <BrandMark size={52} />
        <h3>{role === "teacher" ? "Upload your notes to begin" : "Pick something to study"}</h3>
        <p>
          {role === "teacher"
            ? "Add a PDF to your library, then approve it so students can ask questions about it."
            : "Choose a document from your library. Every answer will show the exact sentence it came from."}
        </p>
      </div>
    </div>
  );
}
