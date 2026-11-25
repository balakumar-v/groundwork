import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { DocumentRecord, GapReport as GapReportData } from "../types";
import { IconArrowLeft } from "./icons";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Teacher-only view of what students asked that the notes couldn't answer:
 * the signal for "what should I add to these notes next".
 */
export function GapReport({ documents }: { documents: DocumentRecord[] }) {
  const { id } = useParams<{ id: string }>();
  const doc = documents.find((d) => d.id === id);
  const [report, setReport] = useState<GapReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await api.getGapReport(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the gap report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const maxTopic = Math.max(1, ...(report?.missingTopics.map((t) => t.count) ?? [1]));

  return (
    <div className="gap-screen">
      <header className="chat-header">
        <div className="chat-header-text">
          <h2>Gap report</h2>
          <div className="doc-meta-line">
            <span>{doc?.filename ?? ""}</span>
          </div>
        </div>
        <Link to={`/documents/${id}`} className="chat-header-link">
          <IconArrowLeft /> Back to chat
        </Link>
      </header>

      <div className="gap-body">
        {loading && <p className="gap-note">Loading…</p>}
        {error && <div className="error-banner">{error}</div>}

        {report && !loading && report.totalRefusals === 0 && (
          <div className="gap-empty">
            <h3>No gaps yet</h3>
            <p>When students ask something these notes can't answer, it will show up here so you know what to add.</p>
          </div>
        )}

        {report && !loading && report.totalRefusals > 0 && (
          <>
            <div className="gap-summary">
              <div className="gap-stat">
                <span className="gap-stat-number">{report.totalRefusals}</span>
                <span className="gap-stat-label">unanswered {report.totalRefusals === 1 ? "question" : "questions"}</span>
              </div>
              <div className="gap-stat">
                <span className="gap-stat-number">{report.questions.length}</span>
                <span className="gap-stat-label">distinct {report.questions.length === 1 ? "question" : "questions"}</span>
              </div>
              <button type="button" className="gap-refresh" onClick={() => void load()}>
                Refresh
              </button>
            </div>

            <section className="gap-section">
              <h3>Topics your notes may be missing</h3>
              {report.missingTopics.length === 0 ? (
                <p className="gap-note">
                  No topic hints yet. When nothing in the notes is even close, the tutor can't name what's missing — see the
                  questions below.
                </p>
              ) : (
                <ul className="gap-topics">
                  {report.missingTopics.map((t) => (
                    <li key={t.topic}>
                      <div className="gap-topic-row">
                        <span className="gap-topic-name">{t.topic}</span>
                        <span className="gap-topic-count">{t.count}×</span>
                      </div>
                      <div className="gap-bar">
                        <div className="gap-bar-fill" style={{ width: `${(t.count / maxTopic) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="gap-section">
              <h3>What students asked</h3>
              <ul className="gap-questions">
                {report.questions.map((q) => (
                  <li key={q.question} className="gap-question">
                    <span className="gap-question-text">{q.question}</span>
                    <span className="gap-question-meta">
                      asked {q.timesAsked}× · {q.distinctStudents} {q.distinctStudents === 1 ? "student" : "students"}
                      {formatDate(q.lastAsked) ? ` · last ${formatDate(q.lastAsked)}` : ""}
                    </span>
                    {q.missing && <span className="gap-question-missing">Missing: {q.missing}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
