"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Mail, TicketCheck, Zap } from "lucide-react";

interface User {
  id: string;
  email: string;
  createdAt: number;
}

export default function AuthForm({
  onAuth,
}: {
  onAuth: (user: User) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { email, password, code, remember }
            : { email, password, remember },
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Error");
        return;
      }
      onAuth(data.user as User);
    } catch {
      setError("No se pudo conectar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wrap auth-wrap">
      <div className="auth-hero">
        <span className="brand-mark">
          <Zap size={30} strokeWidth={2.5} fill="currentColor" />
        </span>
        <h1>Monitor de Luz</h1>
        <p>Enterate al instante cuando se corta la electricidad en tus lugares.</p>
      </div>

      <form className="card auth" onSubmit={submit} aria-describedby={error ? errorId : undefined}>
        <div className="tabs" role="tablist" aria-label="Ingresar o crear cuenta">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "tab active" : "tab"}
            onClick={() => setMode("login")}
          >
            Ingresar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "tab active" : "tab"}
            onClick={() => setMode("register")}
          >
            Crear cuenta
          </button>
        </div>

        <label htmlFor="auth-email">
          Correo
          <span className="field">
            <Mail size={17} aria-hidden="true" />
            <input
              id="auth-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </span>
        </label>

        <label htmlFor="auth-password">
          Contraseña
          <span className="field">
            <KeyRound size={17} aria-hidden="true" />
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>

        {mode === "register" && (
          <label htmlFor="auth-code">
            Código de invitación <span className="faint">(si te lo pidieron)</span>
            <span className="field">
              <TicketCheck size={17} aria-hidden="true" />
              <input
                id="auth-code"
                type="text"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </span>
          </label>
        )}

        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Mantener sesión iniciada en este dispositivo
        </label>

        {error && (
          <p className="err" id={errorId} role="alert">
            {error}
          </p>
        )}

        <button className="primary block" disabled={busy}>
          {busy && <Loader2 size={17} className="spin" aria-hidden="true" />}
          {mode === "login" ? "Ingresar" : "Crear cuenta"}
        </button>
      </form>

      <footer>
        Al crear una cuenta vas a ver los dispositivos que te compartan.
      </footer>
    </main>
  );
}
