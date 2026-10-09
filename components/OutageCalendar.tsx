"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, List, ZapOff, ShieldCheck } from "lucide-react";
import { calendarDay, formatDuration, nextDate, type CalendarDevice } from "@/lib/outageCalendar";
import { localDateKey } from "@/lib/stats";
import Modal from "./Modal";

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-VE", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const moveMonth = (month: string, delta: number) => {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};

export default function OutageCalendar({ devices, tz, now }: { devices: CalendarDevice[]; tz: string; now: number }) {
  const today = localDateKey(now, tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [deviceId, setDeviceId] = useState("all");
  const [mode, setMode] = useState<"calendar" | "agenda">("calendar");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDevices = deviceId === "all" ? devices : devices.filter(d => d.id === deviceId);
  const firstObserved = selectedDevices.reduce((first, d) => d.observedFrom === null ? first : Math.min(first, d.observedFrom), now);
  const earliestMonth = localDateKey(firstObserved, tz).slice(0, 7);
  const days: string[] = [];
  for (let day = `${month}-01`; day.slice(0, 7) === month; day = nextDate(day)) days.push(day);
  const summaries = days.map(date => ({ date, ...calendarDay(selectedDevices, date, tz, now) }));
  const affected = summaries.filter(d => d.events.length > 0);
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const detail = selected ? calendarDay(selectedDevices, selected, tz, now) : null;
  const time = (at: number) => new Intl.DateTimeFormat("es-VE", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(at);
  const stamp = (at: number) => `${dateLabel(localDateKey(at, tz), { day: "numeric", month: "short" })}, ${time(at)}`;

  return <section className="card outage-calendar" aria-label="Calendario de cortes de luz">
    <div className="report-heading"><span className="report-icon"><CalendarDays size={22} /></span><div><h2>Tu luz, día a día</h2><p className="muted">Toca un día para ver qué pasó y a qué hora.</p></div></div>
    <label className="calendar-filter">Ubicación
      <select value={deviceId} onChange={e => { setDeviceId(e.target.value); setSelected(null); }}>
        <option value="all">Todas las ubicaciones</option>
        {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
    <div className="calendar-nav">
      <button className="icon-only ghost" aria-label="Mes anterior" disabled={month <= earliestMonth} onClick={() => setMonth(moveMonth(month, -1))}><ChevronLeft size={20} /></button>
      <h3 aria-live="polite">{dateLabel(`${month}-01`, { month: "long", year: "numeric" })}</h3>
      <button className="icon-only ghost" aria-label="Mes siguiente" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(moveMonth(month, 1))}><ChevronRight size={20} /></button>
    </div>
    <div className="calendar-tools">
      <div className="calendar-modes" aria-label="Presentación del historial">
        <button className={mode === "calendar" ? "sm chip active" : "sm chip"} aria-pressed={mode === "calendar"} onClick={() => setMode("calendar")}><CalendarDays size={15} /> Calendario</button>
        <button className={mode === "agenda" ? "sm chip active" : "sm chip"} aria-pressed={mode === "agenda"} onClick={() => setMode("agenda")}><List size={15} /> Agenda</button>
      </div>
      {month !== today.slice(0, 7) && <button className="sm ghost" onClick={() => setMonth(today.slice(0, 7))}>Mes actual</button>}
    </div>
    <div className="month-insight"><ZapOff size={17} /><p><b>{affected.length} {affected.length === 1 ? "día con cortes" : "días con cortes"}</b><span>{formatDuration(summaries.reduce((sum, d) => sum + d.outageMs, 0))} sin luz registrada{selectedDevices.length > 1 ? " · suma de ubicaciones" : ""}</span></p></div>
    {mode === "calendar" ? <>
      <div className="calendar-grid">
        {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => <span className="weekday" key={i} aria-label={["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][i]}>{d}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
        {summaries.map(day => {
          const unavailable = day.observedCount === 0 || day.date > today;
          return <button key={day.date} disabled={unavailable} className={`calendar-day ${day.events.length ? "has-outage" : "quiet"} ${day.date === today ? "is-today" : ""}`} aria-label={`${dateLabel(day.date, { day: "numeric", month: "long" })}: ${unavailable ? "sin datos" : day.events.length ? `${day.events.length} cortes, ${formatDuration(day.outageMs)} sin luz` : "sin cortes registrados"}${day.partial && !unavailable ? ", datos parciales" : ""}`} aria-haspopup="dialog" onClick={() => setSelected(day.date)}>
            <span className="day-number">{Number(day.date.slice(8))}</span>
            {day.events.length > 0 ? <><span className="day-badge">{day.events.length}<span className="day-badge-word"> {day.events.length === 1 ? "corte" : "cortes"}</span></span><span className="day-duration">{formatDuration(day.outageMs)}</span></> : <span className="day-indicator">{unavailable ? "—" : day.partial ? "◐" : "·"}</span>}
          </button>;
        })}
      </div>
      <div className="calendar-legend"><span><i className="legend-dot outage" /> Con cortes</span><span><i className="legend-dot quiet" /> Sin cortes registrados</span><span>◐ Parcial · — Sin datos</span></div>
    </> : <div className="outage-agenda">
      {affected.length === 0 && <p className="hint"><ShieldCheck size={18} /> No hay cortes registrados en este mes.</p>}
      {[...affected].reverse().map(day => <button className="agenda-day" key={day.date} aria-haspopup="dialog" onClick={() => setSelected(day.date)}>
        <span className="agenda-date"><b>{Number(day.date.slice(8))}</b>{dateLabel(day.date, { weekday: "short" })}</span>
        <span className="agenda-info"><b>{day.events.length} {day.events.length === 1 ? "corte" : "cortes"} · {formatDuration(day.outageMs)}</b><span>{day.events.slice(0, 2).map(iv => `${time(iv.dayStart).slice(0, 5)} · ${iv.deviceName}`).join(" / ")}{day.events.length > 2 ? ` / +${day.events.length - 2} más` : ""}</span></span><ChevronRight size={17} />
      </button>)}
    </div>}
    <p className="faint">Horas en {tz}. El historial refleja pérdidas de comunicación del monitor; también pueden deberse a la conexión a internet.</p>
    {selected && detail && <Modal title={dateLabel(selected, { weekday: "long", day: "numeric", month: "long" })} onClose={() => setSelected(null)}>
      <div className="day-summary"><div><span className="muted">Sin luz registrada</span><strong>{formatDuration(detail.outageMs)}</strong></div><div><span className="muted">Cortes en este día</span><strong>{detail.events.length}</strong></div></div>
      <p className="muted">{detail.starts} iniciados este día{detail.events.length > detail.starts ? ` · ${detail.events.length - detail.starts} desde el día anterior` : ""}.{selectedDevices.length > 1 ? " El tiempo total suma las ubicaciones." : ""}{detail.partial ? " Datos parciales: el historial no cubre todo el día o todas las ubicaciones." : ""}{selected === today ? ` Hasta las ${time(now)}.` : ""}</p>
      <div className="daily-timelines">
        <h3 className="chart-title"><Clock3 size={16} /> El día en una mirada</h3>
        {selectedDevices.map(device => <div key={device.id} className="timeline-device"><b>{device.name}</b><div className="day-track" role="img" aria-label={`${device.name}: ${detail.events.filter(iv => iv.deviceId === device.id).map(iv => `${time(iv.dayStart)} a ${time(iv.dayEnd)}`).join(", ") || "sin cortes registrados"}. Las zonas grises no tienen datos.`}>
          {device.observedFrom !== null && device.observedFrom < detail.until && <span className="observed-track" style={{ left: `${Math.max(0, (device.observedFrom - detail.start) / (detail.end - detail.start) * 100)}%`, right: `${(detail.end - detail.until) / (detail.end - detail.start) * 100}%` }} />}
          {detail.events.filter(iv => iv.deviceId === device.id).map(iv => <span className="outage-track" key={iv.start} style={{ left: `${(iv.dayStart - detail.start) / (detail.end - detail.start) * 100}%`, width: `${Math.max(.4, (iv.dayEnd - iv.dayStart) / (detail.end - detail.start) * 100)}%` }} />)}
        </div><div className="time-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div>)}
        <p className="faint">Rojo: corte registrado · Verde: sin cortes registrados · Gris: sin datos.</p>
      </div>
      {detail.events.length === 0 ? <div className="empty-state"><ShieldCheck /><b>Un día sin cortes registrados</b><p>No se registraron interrupciones en el período observado.</p></div> : <ol className="outage-events">{detail.events.map(iv => <li key={`${iv.deviceId}-${iv.start}`}>
        <div className="event-heading"><b>{iv.deviceName}</b><span className={`badge ${iv.ongoing ? "off" : "on"}`}>{iv.ongoing ? "En curso" : "Restablecido"}</span></div>
        <div className="event-times"><span><ZapOff size={15} /> Se fue <b>{stamp(iv.start)}</b></span><span><ShieldCheck size={15} /> {iv.ongoing ? "Sin retorno registrado" : <>Volvió <b>{stamp(iv.end)}</b></>}</span></div>
        <p><b>{formatDuration(iv.dayEnd - iv.dayStart)}</b> en este día{iv.start < detail.start || iv.end > detail.end ? ` · ${formatDuration(iv.end - iv.start)} en total` : ""}</p>
      </li>)}</ol>}
    </Modal>}
  </section>;
}
