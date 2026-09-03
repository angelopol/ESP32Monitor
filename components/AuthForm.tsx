"use client";

import { useState } from "react";

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
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <main className="wrap">
      <h1 className="title">Monitor de Luz</h1>
      <form className="card auth" onSubmit={submit}>
        <div className="tabs">
          <button
            type="button"
            className={mode === "login" ? "tab active" : "tab"}
            onClick={() => setMode("login")}
          >
            Ingresar
          </button>
          <button
            type="button"
            className={mode === "register" ? "tab active" : "tab"}
            onClick={() => setMode("register")}
          >
            Crear cuenta
          </button>
        </div>

        <label>
          Correo
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === "register" && (
          <label>
            Código de invitación <span className="muted">(si te lo pidieron)</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
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

        {error && <p className="err">{error}</p>}

        <button className="primary" disabled={busy}>
          {busy ? "..." : mode === "login" ? "Ingresar" : "Crear cuenta"}
        </button>
      </form>
      <footer>
        Al crear una cuenta vas a ver los dispositivos que te compartan.
      </footer>
    </main>
  );
}
