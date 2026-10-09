import { dayStartMs, type Interval } from "./stats";

export interface CalendarDevice {
  id: string;
  name: string;
  observedFrom: number | null;
  outages: Interval[];
}

export function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Split at local midnight without losing the original start/return times. */
export function calendarDay(devices: CalendarDevice[], date: string, tz: string, now: number) {
  const start = dayStartMs(date, tz);
  const end = dayStartMs(nextDate(date), tz);
  const until = Math.min(end, now);
  const observed = devices.filter(d => start < now && d.observedFrom !== null && d.observedFrom < until);
  const events = observed.flatMap(device => device.outages
    .filter(iv => iv.start < until && iv.end > start)
    .map(iv => ({ ...iv, deviceId: device.id, deviceName: device.name,
      dayStart: Math.max(start, iv.start), dayEnd: Math.min(until, iv.end) })))
    .sort((a, b) => a.dayStart - b.dayStart || a.deviceName.localeCompare(b.deviceName));
  return {
    start, end, until, events,
    observedCount: observed.length,
    partial: observed.some(d => d.observedFrom! > start) || observed.length < devices.length,
    outageMs: events.reduce((sum, iv) => sum + iv.dayEnd - iv.dayStart, 0),
    starts: events.filter(iv => iv.start >= start).length,
  };
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 min";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}
