"use client";

import { useCallback, useEffect, useState } from "react";

type NotifState =
  | "loading"
  | "unsupported"
  | "denied"
  | "off"
  | "on";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export default function NotificationButton() {
  const [state, setState] = useState<NotifState>("loading");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/vapid").then((r) => r.json());
      if (!publicKey) {
        setMsg("El servidor no tiene claves VAPID configuradas.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(publicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("on");
      setMsg("Vas a recibir avisos aunque la app esté cerrada.");
    } catch (err) {
      console.error(err);
      setMsg("No se pudo activar.");
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
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
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
        tag: "test",
      });
    } catch {
      setMsg("No se pudo mostrar la prueba.");
    }
  }, []);

  return (
    <div className="notif">
      {state === "loading" && <span className="muted">…</span>}
      {state === "unsupported" && (
        <span className="muted">
          Este navegador no soporta notificaciones push.
        </span>
      )}
      {state === "denied" && (
        <span className="muted">
          Notificaciones bloqueadas: habilitalas en la config del navegador.
        </span>
      )}
      {state === "off" && (
        <button className="primary sm" onClick={enable} disabled={busy}>
          Activar notificaciones
        </button>
      )}
      {state === "on" && (
        <>
          <button className="sm" onClick={test}>
            Probar
          </button>
          <button className="sm ghost" onClick={disable} disabled={busy}>
            Desactivar avisos
          </button>
        </>
      )}
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
