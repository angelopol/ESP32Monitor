"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  LogOut,
  Plus,
  PlugZap,
  RotateCw,
  Settings,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import NotificationButton from "./NotificationButton";
import DeviceCard, { type Device } from "./DeviceCard";
import DeviceModal from "./DeviceModal";
import StatsView from "./StatsView";

interface User {
  id: string;
  email: string;
  createdAt: number;
}

const PAGE_SIZE = 5;

export default function AppShell({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [view, setView] = useState<"devices" | "stats" | "settings">("devices");
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
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

  // Cierra el modal solo si el dispositivo abierto desapareció de la lista
  // (por ejemplo, lo acaban de eliminar).
  useEffect(() => {
    if (openDeviceId && devices && !devices.some((d) => d.id === openDeviceId)) {
      setOpenDeviceId(null);
    }
  }, [devices, openDeviceId]);

  const totalPages = Math.max(1, Math.ceil((devices?.length ?? 0) / PAGE_SIZE));
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);

  const pageItems = (devices ?? []).slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const openDevice = devices?.find((d) => d.id === openDeviceId) ?? null;

  const logout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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
        <span className="brand">
          <span className="brand-mark">
            <Zap size={17} strokeWidth={2.5} fill="currentColor" />
          </span>
          <span className="identity">
            <h1 className="title">Monitor de Luz</h1>
            <span className="email">{user.email}</span>
          </span>
        </span>
        <button className="sm ghost" onClick={logout} disabled={loggingOut}>
          <LogOut size={16} />
          Salir
        </button>
      </header>

      <nav className="seg" aria-label="Secciones">
        <button
          className={view === "devices" ? "seg-btn active" : "seg-btn"}
          onClick={() => setView("devices")}
          aria-current={view === "devices"}
        >
          <Wifi size={15} />
          Dispositivos
        </button>
        <button
          className={view === "stats" ? "seg-btn active" : "seg-btn"}
          onClick={() => setView("stats")}
          aria-current={view === "stats"}
        >
          <BarChart3 size={15} />
          Estadísticas
        </button>
        <button
          className={view === "settings" ? "seg-btn active" : "seg-btn"}
          onClick={() => setView("settings")}
          aria-current={view === "settings"}
        >
          <Settings size={15} />
          Ajustes
        </button>
      </nav>

      {view === "stats" && <StatsView />}

      {view === "settings" && (
        <div className="settings">
          <div className="card">
            <p className="chart-title">
              <Settings size={14} aria-hidden="true" />
              Notificaciones
            </p>
            <NotificationButton />
          </div>
          {!standalone && (
            <p className="hint">
              <Download size={16} aria-hidden="true" />
              Instalá la app (menú del navegador →{" "}
              <b>Agregar a pantalla de inicio</b>) para recibir avisos con la
              app cerrada.
            </p>
          )}
        </div>
      )}

      {view === "devices" && (
        <>
          <div className="devices-toolbar">
            <button
              className="sm icon-only ghost"
              onClick={manualRefresh}
              disabled={refreshing}
              aria-label="Actualizar dispositivos"
            >
              <RotateCw size={16} className={refreshing ? "spin" : ""} />
            </button>
            {!adding && (
              <button className="sm grow" onClick={() => setAdding(true)}>
                <Plus size={16} />
                Agregar dispositivo
              </button>
            )}
          </div>

          {adding && (
            <form className="card add-form" onSubmit={createDevice}>
              <label htmlFor="new-device-name">
                Nombre del dispositivo{" "}
                <span className="faint">(ej. Casa, Oficina)</span>
                <input
                  id="new-device-name"
                  autoFocus
                  autoComplete="off"
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
          )}

          {error && (
            <p className="err" role="alert">
              <WifiOff size={16} />
              Sin conexión al servidor.
            </p>
          )}

          {devices?.length === 0 && (
            <div className="empty-state">
              <PlugZap aria-hidden="true" />
              <p>
                Todavía no tenés dispositivos. Creá uno o pedile a alguien que
                te comparta el suyo con este correo.
              </p>
            </div>
          )}

          {devices === null && !error && (
            <>
              <div className="skeleton skeleton-card" aria-hidden="true" />
              <div className="skeleton skeleton-card" aria-hidden="true" />
            </>
          )}

          <div className="devices">
            {pageItems.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                onOpen={() => setOpenDeviceId(d.id)}
              />
            ))}
          </div>

          {devices && devices.length > PAGE_SIZE && (
            <div className="pager">
              <button
                className="sm icon-only ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Página anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="muted">
                Página {page + 1} de {totalPages}
              </span>
              <button
                className="sm icon-only ghost"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                aria-label="Página siguiente"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {openDevice && (
        <DeviceModal
          device={openDevice}
          origin={origin.current}
          onChanged={load}
          onClose={() => setOpenDeviceId(null)}
        />
      )}

      <footer>
        <Zap size={13} aria-hidden="true" />
        Cada dispositivo es una ubicación. El ESP32 hace ping con su token; si
        deja de responder más que el umbral, te llega “No hay luz en …”.
      </footer>
    </main>
  );
}
