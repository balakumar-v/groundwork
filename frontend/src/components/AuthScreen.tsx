import { useState } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import type { Role } from "../types";
import { APP_NAME } from "../brand";
import { Wordmark } from "./BrandMark";
import { IconArrowLeft, IconArrowRight, IconBook, IconUpload } from "./icons";

type Mode = "login" | "signup";

const ROLE_COPY: Record<Role, { label: string; tagline: string; points: string[] }> = {
  teacher: {
    label: "Teacher",
    tagline: "Publish notes students can trust",
    points: ["Upload notes and textbook chapters", "Approve what students can study from", "Withdraw notes at any time"],
  },
  student: {
    label: "Student",
    tagline: "Study from approved notes",
    points: ["Ask in plain language", "See the exact sentence behind every answer", "Get told clearly when the notes don't cover it"],
  },
};

export function AuthScreen({ auth }: { auth: ReturnType<typeof useAuth> }) {
  // null = still on the "who's signing in?" card chooser.
  const [role, setRole] = useState<Role | null>(null);

  return (
    <div className="auth-screen">
      <Hero />
      <main className="auth-panel">
        {role === null ? (
          <RoleChooser onChoose={setRole} />
        ) : (
          <RoleSignIn key={role} role={role} auth={auth} onBack={() => setRole(null)} />
        )}
      </main>
    </div>
  );
}

/** Left side: says what the product does by showing it. */
function Hero() {
  return (
    <section className="auth-hero">
      <Wordmark size={34} />

      <div className="auth-hero-copy">
        <h1 className="auth-headline">Answers that show their source</h1>
        <p className="auth-lede">
          Ask questions about notes your teacher approved. Every answer points to the exact sentence it came from, and
          says so when the notes don't cover your question.
        </p>
      </div>

      <figure className="hero-sample" aria-label="Example of an answer with its source">
        <div className="hero-q">How is kinetic energy calculated?</div>
        <p className="hero-a">
          Kinetic energy is half the mass times the speed squared, measured in joules.
          <span className="citation-marker static">1</span>
        </p>
        <div className="source-card static">
          <div className="source-head">
            <span className="source-num">1</span>
            <span className="source-where">Page 4 · Kinetic Energy and Work</span>
          </div>
          <blockquote className="source-passage">
            <mark>The kinetic energy of a moving body is KE = 0.5 × m × v², where m is its mass and v its speed.</mark>
          </blockquote>
        </div>
        <figcaption className="hero-caption">Example answer</figcaption>
      </figure>
    </section>
  );
}

function RoleChooser({ onChoose }: { onChoose: (role: Role) => void }) {
  return (
    <div className="auth-card auth-card-wide">
      <h2 className="auth-title">Who's signing in?</h2>
      <p className="auth-subtitle">Pick your role. Teachers and students use separate sign-ins.</p>

      <div className="role-grid">
        {(["teacher", "student"] as const).map((r) => (
          <button key={r} type="button" className="role-card" data-role={r} onClick={() => onChoose(r)}>
            <span className="role-card-icon">{r === "teacher" ? <IconUpload /> : <IconBook />}</span>
            <span className="role-card-label">{ROLE_COPY[r].label}</span>
            <span className="role-card-tagline">{ROLE_COPY[r].tagline}</span>
            <ul className="role-card-points">
              {ROLE_COPY[r].points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <span className="role-card-cta">
              Continue as {ROLE_COPY[r].label.toLowerCase()} <IconArrowRight />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoleSignIn({ role, auth, onBack }: { role: Role; auth: ReturnType<typeof useAuth>; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teacherCode, setTeacherCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = ROLE_COPY[role];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") {
        await auth.login(email, password, role);
      } else {
        await auth.signup(email, password, role, teacherCode);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={(e) => void handleSubmit(e)}>
      <button type="button" className="auth-back" disabled={submitting} onClick={onBack}>
        <IconArrowLeft /> Change role
      </button>

      <h2 className="auth-title">
        {copy.label} {mode === "login" ? "sign in" : "sign up"}
      </h2>
      <p className="auth-subtitle">
        {mode === "login" ? `Welcome back to ${APP_NAME}.` : `Create your ${copy.label.toLowerCase()} account.`}
      </p>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <label className="auth-field">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          disabled={submitting}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="auth-field">
        <span>Password</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          disabled={submitting}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "signup" && <small>At least 8 characters.</small>}
      </label>

      {role === "teacher" && mode === "signup" && (
        <label className="auth-field">
          <span>Teacher access code (if your institution gave you one)</span>
          <input
            type="text"
            autoComplete="off"
            value={teacherCode}
            disabled={submitting}
            onChange={(e) => setTeacherCode(e.target.value)}
          />
        </label>
      )}

      <button type="submit" className="send-btn auth-submit" disabled={submitting}>
        {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>

      <button
        type="button"
        className="auth-switch"
        disabled={submitting}
        onClick={() => {
          setMode((m) => (m === "login" ? "signup" : "login"));
          setError(null);
        }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
