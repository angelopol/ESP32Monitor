"use client";

import { ChevronRight, SignalHigh, Zap, ZapOff } from "lucide-react";

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

/**
 * Resumen compacto de un dispositivo. Al tocarlo se abre el modal
 * (DeviceModal) con el detalle y las acciones avanzadas (renombrar,
 * compartir, conexión ESP32, eliminar, umbral, señal).
 */
export default function DeviceCard({
  device,
  onOpen,
}: {
  device: Device;
  onOpen: () => void;
}) {
  const st = device.status.state;

  return (
    <button type="button" className={`device ${st}`} onClick={onOpen} aria-haspopup="dialog">
      <span className={`status-pill ${st}`} aria-hidden="true">
        {st === "on" && <Zap size={17} strokeWidth={2.5} fill="currentColor" />}
        {st === "off" && <ZapOff size={17} strokeWidth={2.5} />}
        {st === "unknown" && <SignalHigh size={17} />}
      </span>

      <span className="device-summary">
        <span className="device-name-row">
          <h3>{device.name}</h3>
          {!device.isOwner && <span className="badge">compartido</span>}
        </span>
        <span className={`device-state-compact ${st === "off" ? "off" : ""}`}>
          {st === "on" && "Hay luz"}
          {st === "off" && "Se fue la luz"}
          {st === "unknown" && "Sin datos todavía"}
          {device.status.secondsSincePing != null && (
            <span className="faint"> · hace {device.status.secondsSincePing}s</span>
          )}
        </span>
      </span>

      <ChevronRight className="device-chevron" size={18} aria-hidden="true" />
    </button>
  );
}
