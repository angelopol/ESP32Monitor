"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface HistoryEvent {
  state: "on" | "off";
  at: number;
  trigger: string;
}

interface Status {
  power: boolean;
  state: "on" | "off" | "unknown";
  lastPingAt: string | null;
  secondsSincePing: number | null;
  since: string | null;
  thresholdSeconds: number;
  rssi: number | null;
  serverTime: string;
  history?: HistoryEvent[];
}

type NotifState = "unsupported" | "default" | "denied" | "subscribed" | "granted-not-subscribed";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [notif, setNotif] = useState<NotifState>("default");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const tick = useRef(0);

  // --- polling de estado ---
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status?history=1", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => {
      tick.current += 1;
      fetchStatus();
    }, 5000);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchStatus]);

  // --- estado de notificaciones ---
  useEffect(() => {
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error iOS
        window.navigator.standalone === true,
    );

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotif("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setNotif("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (sub) setNotif("subscribed");
        else
          setNotif(
            Notification.permission === "granted"
              ? "granted-not-subscribed"
              : "default",
          );
      })
      .catch(() => setNotif("default"));
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setNotif(perm === "denied" ? "denied" : "default");
        setMsg("Permiso de notificaciones no otorgado.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/vapid").then((r) => r.json());
      if (!publicKey) {
        setMsg("El servidor no tiene configuradas las claves VAPID.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      });
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error(String(res.status));
      setNotif("subscribed");
      setMsg("Listo. Vas a recibir avisos aunque la app esté cerrada.");
    } catch (err) {
      console.error(err);
      setMsg("No se pudo activar. Revisá la consola.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setNotif("granted-not-subscribed");
      setMsg("Notificaciones desactivadas en este dispositivo.");
    } catch (err) {
      console.error(err);
      setMsg("No se pudo desactivar.");
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("🔔 Prueba", {
        body: "Las notificaciones funcionan.",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "power",
      });
    } catch {
      setMsg("No se pudo mostrar la notificación de prueba.");
    }
  }, []);

  const state = status?.state ?? "unknown";
  const secs = status?.secondsSincePing;

  return (
    <main className="wrap">
      <h1 className="title">Monitor de Luz</h1>

      <section className={`status-card ${state}`}>
        <div>
          <span className={`dot ${state}`} />
          <span className="status-sub">
            {error
              ? "sin conexión al servidor"
              : state === "unknown"
                ? "esperando primer ping"
                : `monitor ${state === "on" ? "en línea" : "sin señal"}`}
          </span>
        </div>
        <p className="status-big">
          {state === "on"
            ? "HAY LUZ"
            : state === "off"
              ? "SE FUE LA LUZ"
              : "SIN DATOS"}
        </p>
        <p className="status-sub">
          {secs != null
            ? `último ping hace ${secs}s`
            : "todavía no llegó ningún ping"}
        </p>
      </section>

      <section className="card rows">
        <div className="row">
          <span>Último ping</span>
          <span>{fmtDateTime(status?.lastPingAt ?? null)}</span>
        </div>
        <div className="row">
          <span>Cambió de estado</span>
          <span>{fmtDateTime(status?.since ?? null)}</span>
        </div>
        <div className="row">
          <span>Umbral de corte</span>
          <span>{status?.thresholdSeconds ?? "—"} s</span>
        </div>
        <div className="row">
          <span>Señal WiFi (RSSI)</span>
          <span>{status?.rssi != null ? `${status.rssi} dBm` : "—"}</span>
        </div>
      </section>

      <section className="card btns">
        {notif === "unsupported" && (
          <p className="hint">
            Este navegador no soporta notificaciones push. Probá con Chrome
            (Android) o instalando la app en iOS 16.4+.
          </p>
        )}
        {notif === "denied" && (
          <p className="hint">
            Bloqueaste las notificaciones. Habilitalas desde la configuración del
            navegador para este sitio.
          </p>
        )}
        {(notif === "default" || notif === "granted-not-subscribed") && (
          <button className="primary" onClick={enable} disabled={busy}>
            Activar notificaciones
          </button>
        )}
        {notif === "subscribed" && (
          <>
            <button onClick={test}>Probar notificación</button>
            <button className="danger" onClick={disable} disabled={busy}>
              Desactivar notificaciones
            </button>
          </>
        )}
        <p className="msg">{msg}</p>
        {!standalone && (
          <p className="hint">
            Para que los avisos lleguen con la app cerrada, instalá esta página:
            menú del navegador → <b>Agregar a pantalla de inicio</b>.
          </p>
        )}
      </section>

      {status?.history && status.history.length > 0 && (
        <section className="card history">
          <span className="status-sub">Historial</span>
          {status.history.slice(0, 8).map((ev, i) => (
            <div className="ev" key={`${ev.at}-${i}`}>
              <b>{ev.state === "on" ? "Volvió la luz" : "Se fue la luz"}</b>
              <span>{fmtDateTime(new Date(ev.at).toISOString())}</span>
            </div>
          ))}
        </section>
      )}

      <footer>
        endpoint IoT: <code>/api/status?format=plain</code> → ON / OFF
      </footer>
    </main>
  );
}
