"use client";

import { useCallback, useEffect, useState } from "react";

type NotifState = "loading" | "unsupported" | "denied" | "off" | "on";

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

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    refresh();
    // Al volver a la pestaña (p. ej. tras cambiar permisos en Ajustes) re-chequea.
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        if (perm === "denied")
          setMsg("Sigue bloqueado. Seguí los pasos de arriba y volvé a probar.");
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
        <div className="notif-denied">
          <span className="muted">
            Las notificaciones están <b>bloqueadas</b> para este sitio.
            Desbloquealas y después tocá “Reintentar”:
          </span>
          <ul className="muted">
            <li>
              Navegador: tocá el candado 🔒 (o la ⓘ) junto a la dirección →
              <b> Permisos</b> → <b>Notificaciones</b> → <b>Permitir</b>.
            </li>
            <li>
              App instalada: Ajustes del teléfono → <b>Apps</b> → Monitor de Luz
              → <b>Notificaciones</b> → activar.
            </li>
          </ul>
          <div className="btns-row">
            <button className="sm primary" onClick={enable} disabled={busy}>
              Reintentar
            </button>
            <button className="sm ghost" onClick={refresh} disabled={busy}>
              Ya lo desbloqueé
            </button>
          </div>
        </div>
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
