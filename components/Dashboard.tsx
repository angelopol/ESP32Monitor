"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import AuthForm from "./AuthForm";
import AppShell from "./AppShell";

interface User {
  id: string;
  email: string;
  createdAt: number;
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="wrap">
        <span className="brand">
          <span className="brand-mark">
            <Zap size={17} strokeWidth={2.5} fill="currentColor" />
          </span>
          <h1 className="title">Monitor de Luz</h1>
        </span>
        <div className="skeleton skeleton-card" aria-hidden="true" />
        <div className="skeleton skeleton-card" aria-hidden="true" />
        <span className="muted" role="status">
          Cargando…
        </span>
      </main>
    );
  }

  if (!user) return <AuthForm onAuth={setUser} />;
  return <AppShell user={user} onLogout={() => setUser(null)} />;
}
