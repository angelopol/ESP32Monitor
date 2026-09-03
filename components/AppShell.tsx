"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NotificationButton from "./NotificationButton";
import DeviceCard, { type Device } from "./DeviceCard";
import StatsView from "./StatsView";

interface User {
  id: string;
  email: string;
  createdAt: number;
}

export default function AppShell({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [view, setView] = useState<"devices" | "stats">("devices");
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const origin = useRef("");

  useEffect(() => {
    origin.current = window.location.origin;
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error iOS
        window.navigator.standalone === true,
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setDevices((await res.json()).devices as Device[]);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  const createDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    await fetch("/api/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setBusy(false);
    setNewName("");
    setAdding(false);
    load();
  };

  return (
    <main className="wrap">
      <header className="app-head">
        <div>
          <h1 className="title">Monitor de Luz</h1>
          <span className="muted">{user.email}</span>
        </div>
        <button className="sm ghost" onClick={logout}>
          Salir
        </button>
      </header>

      <div className="card notif-card">
        <NotificationButton />
      </div>

      <div className="seg">
        <button
          className={view === "devices" ? "seg-btn active" : "seg-btn"}
          onClick={() => setView("devices")}
        >
          Dispositivos
        </button>
        <button
          className={view === "stats" ? "seg-btn active" : "seg-btn"}
          onClick={() => setView("stats")}
        >
          Estadísticas
        </button>
      </div>

      {view === "stats" ? (
        <StatsView />
      ) : (
        <>
          {!standalone && (
            <p className="hint">
              Instalá la app (menú del navegador →{" "}
              <b>Agregar a pantalla de inicio</b>) para recibir avisos con la app
              cerrada.
            </p>
          )}

          {error && <p className="err">Sin conexión al servidor.</p>}

          {devices?.length === 0 && (
            <p className="hint">
              Todavía no tenés dispositivos. Creá uno o pedile a alguien que te
              comparta el suyo con este correo.
            </p>
          )}

          <div className="devices">
            {devices?.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                origin={origin.current}
                onChanged={load}
              />
            ))}
          </div>

          {adding ? (
            <form className="card add-form" onSubmit={createDevice}>
              <label>
                Nombre del dispositivo{" "}
                <span className="muted">(ej. Casa, Oficina)</span>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </label>
              <div className="btns-row">
                <button className="primary sm" disabled={busy}>
                  Crear
                </button>
                <button
                  type="button"
                  className="sm ghost"
                  onClick={() => setAdding(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button className="sm" onClick={() => setAdding(true)}>
              + Agregar dispositivo
            </button>
          )}
        </>
      )}

      <footer>
        Cada dispositivo es una ubicación. El ESP32 hace ping con su token; si
        deja de responder más que el umbral, te llega “No hay luz en …”.
      </footer>
    </main>
  );
}
