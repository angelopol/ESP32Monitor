"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cable,
  Check,
  Clock,
  Copy,
  Gauge,
  Pencil,
  Share2,
  SignalHigh,
  Trash2,
  UserMinus,
  Zap,
  ZapOff,
} from "lucide-react";
import Modal from "./Modal";
import type { Device } from "./DeviceCard";

interface Member {
  id: string;
  email: string;
  isOwner: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-VE", {
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

function fmtHoursMinutes(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, "0")}m`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* portapapeles no disponible: el usuario copia a mano */
    }
  };
  return (
    <button
      type="button"
      className="sm icon-only ghost"
      onClick={copy}
      aria-label={copied ? "Copiado" : "Copiar"}
    >
      {copied ? <Check size={16} color="var(--on)" /> : <Copy size={16} />}
    </button>
  );
}

export default function DeviceModal({
  device,
  origin,
  onChanged,
  onClose,
}: {
  device: Device;
  origin: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<"none" | "share" | "setup">("none");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHoursMinutes, setShowHoursMinutes] = useState(false);

  useEffect(() => setName(device.name), [device.name]);
  useEffect(() => setShowHoursMinutes(false), [device.id]);

  const st = device.status.state;
  const statusUrl = device.token
    ? `${origin}/api/status?token=${device.token}&format=plain`
    : "";

  const loadMembers = useCallback(async () => {
    const res = await fetch(`/api/devices/${device.id}/members`);
    if (res.ok) setMembers((await res.json()).members as Member[]);
  }, [device.id]);

  const toggleShare = () => {
    if (panel === "share") return setPanel("none");
    setPanel("share");
    setMsg("");
    loadMembers();
  };

  const saveName = async () => {
    setBusy(true);
    await fetch(`/api/devices/${device.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    setRenaming(false);
    onChanged();
  };

  const removeDevice = async () => {
    if (!confirm(`¿Eliminar "${device.name}"? Esto no se puede deshacer.`)) return;
    await fetch(`/api/devices/${device.id}`, { method: "DELETE" });
    onChanged();
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/devices/${device.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok || !data.ok) {
      setMsg(data.error || "Error");
      return;
    }
    setInviteEmail("");
    setMsg(
      data.status === "invited"
        ? `Invitado ${data.email}. Verá el dispositivo cuando cree su cuenta con ese correo.`
        : `Agregado ${data.email}.`,
    );
    loadMembers();
  };

  const removeMember = async (userId: string) => {
    await fetch(`/api/devices/${device.id}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    loadMembers();
  };

  const toggleLastPingFormat = () => setShowHoursMinutes((v) => !v);

  return (
    <Modal title={device.name} onClose={onClose}>
      <div className="modal-status">
        <span className={`status-pill lg ${st}`} aria-hidden="true">
          {st === "on" && <Zap size={20} strokeWidth={2.5} fill="currentColor" />}
          {st === "off" && <ZapOff size={20} strokeWidth={2.5} />}
          {st === "unknown" && <SignalHigh size={20} />}
        </span>
        <div>
          <p className={`device-state ${st === "off" ? "off" : ""}`}>
            {st === "on" && "Hay luz"}
            {st === "off" && (
              <>
                <ZapOff size={18} aria-hidden="true" /> Se fue la luz
              </>
            )}
            {st === "unknown" && "Sin datos todavía"}
          </p>
          <span className="muted">
            cambió de estado: {fmt(device.status.since)}
          </span>
        </div>
      </div>

      {!device.isOwner && (
        <span className="badge" style={{ alignSelf: "flex-start" }}>
          compartido
        </span>
      )}

      <div className="device-meta">
        <span className="item">
          <Clock size={14} aria-hidden="true" />
          {device.status.secondsSincePing != null ? (
            <span
              role="button"
              tabIndex={0}
              title="Tocá para alternar entre segundos y horas/minutos"
              onClick={toggleLastPingFormat}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleLastPingFormat();
                }
              }}
            >
              último ping hace{" "}
              {showHoursMinutes
                ? fmtHoursMinutes(device.status.secondsSincePing)
                : `${device.status.secondsSincePing}s`}
            </span>
          ) : (
            "sin pings todavía"
          )}
        </span>
        <span className="item">
          <Gauge size={14} aria-hidden="true" />
          umbral {device.thresholdSeconds}s
        </span>
        {device.status.rssi != null && (
          <span className="item">
            <SignalHigh size={14} aria-hidden="true" />
            señal {device.status.rssi} dBm
          </span>
        )}
      </div>

      {device.isOwner && renaming && (
        <span className="rename">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nombre del dispositivo"
            autoFocus
          />
          <button
            className="sm icon-only"
            onClick={saveName}
            disabled={busy}
            aria-label="Guardar nombre"
          >
            <Check size={16} />
          </button>
        </span>
      )}

      {device.isOwner && (
        <div className="device-actions">
          <button className="sm" onClick={() => setRenaming((v) => !v)}>
            <Pencil size={15} />
            Renombrar
          </button>
          <button
            className="sm"
            onClick={toggleShare}
            aria-expanded={panel === "share"}
          >
            <Share2 size={15} />
            Compartir
          </button>
          <button
            className="sm"
            onClick={() => setPanel(panel === "setup" ? "none" : "setup")}
            aria-expanded={panel === "setup"}
          >
            <Cable size={15} />
            Conexión ESP32
          </button>
          <button className="sm danger" onClick={removeDevice}>
            <Trash2 size={15} />
            Eliminar
          </button>
        </div>
      )}

      {panel === "share" && device.isOwner && (
        <div className="subpanel">
          <form onSubmit={invite} className="invite">
            <input
              type="email"
              inputMode="email"
              placeholder="correo@ejemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              aria-label="Correo a compartir"
            />
            <button className="sm primary" disabled={busy}>
              Agregar
            </button>
          </form>
          {msg && <p className="muted">{msg}</p>}
          <ul className="members">
            {(members ?? []).map((m) => (
              <li key={m.id}>
                <span>{m.email}</span>
                {m.isOwner ? (
                  <span className="badge">dueño</span>
                ) : (
                  <button
                    className="sm ghost"
                    onClick={() => removeMember(m.id)}
                    aria-label={`Quitar a ${m.email}`}
                  >
                    <UserMinus size={14} />
                    quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel === "setup" && device.isOwner && device.token && (
        <div className="subpanel">
          <p className="muted">
            Cargá esto en <code>secrets.h</code> del firmware del ESP32:
          </p>
          <div className="subpanel-row">
            <pre>{`SERVER_URL   = "${origin}"\nDEVICE_TOKEN = "${device.token}"`}</pre>
            <CopyButton
              text={`SERVER_URL   = "${origin}"\nDEVICE_TOKEN = "${device.token}"`}
            />
          </div>
          <p className="muted">Endpoint para otros dispositivos IoT:</p>
          <div className="subpanel-row">
            <code>{statusUrl}</code>
            <CopyButton text={statusUrl} />
          </div>
        </div>
      )}
    </Modal>
  );
}
