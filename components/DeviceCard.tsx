"use client";

import { useCallback, useEffect, useState } from "react";

export interface DeviceStatus {
  power: boolean;
  state: "on" | "off" | "unknown";
  lastPingAt: string | null;
  secondsSincePing: number | null;
  since: string | null;
  rssi: number | null;
}

export interface Device {
  id: string;
  name: string;
  ownerId: string;
  isOwner: boolean;
  thresholdSeconds: number;
  token?: string;
  status: DeviceStatus;
}

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

export default function DeviceCard({
  device,
  origin,
  onChanged,
}: {
  device: Device;
  origin: string;
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState<"none" | "share" | "setup">("none");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(device.name);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(device.name), [device.name]);

  const st = device.status.state;

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

  return (
    <article className={`device ${st}`}>
      <header className="device-head">
        <span className={`dot ${st}`} />
        {renaming ? (
          <span className="rename">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button className="sm" onClick={saveName} disabled={busy}>
              OK
            </button>
          </span>
        ) : (
          <h3>{device.name}</h3>
        )}
        <span className="grow" />
        {!device.isOwner && <span className="badge">compartido</span>}
      </header>

      <p className="device-state">
        {st === "on" ? "Hay luz" : st === "off" ? "SE FUE LA LUZ" : "Sin datos"}
      </p>
      <div className="device-meta">
        <span>
          {device.status.secondsSincePing != null
            ? `último ping hace ${device.status.secondsSincePing}s`
            : "sin pings todavía"}
        </span>
        <span>·</span>
        <span>umbral {device.thresholdSeconds}s</span>
        {device.status.rssi != null && (
          <>
            <span>·</span>
            <span>{device.status.rssi} dBm</span>
          </>
        )}
      </div>
      <div className="device-meta">
        <span>cambió de estado: {fmt(device.status.since)}</span>
      </div>

      {device.isOwner && (
        <div className="device-actions">
          <button className="sm" onClick={() => setRenaming((v) => !v)}>
            Renombrar
          </button>
          <button className="sm" onClick={toggleShare}>
            Compartir
          </button>
          <button
            className="sm"
            onClick={() => setPanel(panel === "setup" ? "none" : "setup")}
          >
            Conexión ESP32
          </button>
          <button className="sm ghost" onClick={removeDevice}>
            Eliminar
          </button>
        </div>
      )}

      {panel === "share" && device.isOwner && (
        <div className="subpanel">
          <form onSubmit={invite} className="invite">
            <input
              type="email"
              placeholder="correo@ejemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
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
                  <button className="sm ghost" onClick={() => removeMember(m.id)}>
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
            Cargá esto en el firmware del ESP32 (<code>ESP32Monitor.ino</code>):
          </p>
          <pre>
{`SERVER_URL   = "${origin}"
DEVICE_TOKEN = "${device.token}"`}
          </pre>
          <p className="muted">
            Endpoint IoT:{" "}
            <code>{`${origin}/api/status?token=${device.token}&format=plain`}</code>
          </p>
        </div>
      )}
    </article>
  );
}
