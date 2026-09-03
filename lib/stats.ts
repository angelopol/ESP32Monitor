/**
 * Estadisticas de cortes de luz a partir del log de eventos de un dispositivo.
 *
 * Un evento es { state: "on"|"off", at }. Un corte es un intervalo off -> on
 * (o off -> ahora si sigue sin luz). Todo se calcula sobre ese log; no hay
 * agregados precalculados.
 */

import type { HistoryEvent } from "./deviceState";

const DAY = 86_400_000;

export type RangeKey = "day" | "week" | "month" | "quarter" | "year";

export const RANGE_MS: Record<RangeKey, number> = {
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
  quarter: 90 * DAY,
  year: 365 * DAY,
};

export interface Interval {
  start: number;
  end: number;
  ongoing: boolean;
}

export function buildOutages(events: HistoryEvent[], now: number): Interval[] {
  const asc = [...events].sort((a, b) => a.at - b.at);
  const out: Interval[] = [];
  let open: number | null = null;
  for (const e of asc) {
    if (e.state === "off") {
      if (open === null) open = e.at;
    } else if (e.state === "on" && open !== null) {
      out.push({ start: open, end: e.at, ongoing: false });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: now, ongoing: true });
  return out;
}

export interface WindowMetrics {
  outageMs: number;
  outageCount: number;
  longestOutageMs: number;
  availability: number;
  mttrMs: number;
  currentlyOut: boolean;
}

export function windowMetrics(
  intervals: Interval[],
  from: number,
  to: number,
): WindowMetrics {
  let outageMs = 0;
  let longest = 0;
  let count = 0;
  let currentlyOut = false;

  for (const iv of intervals) {
    const s = Math.max(iv.start, from);
    const e = Math.min(iv.end, to);
    if (e > s) {
      outageMs += e - s;
      if (e - s > longest) longest = e - s;
      if (iv.ongoing) currentlyOut = true;
    }
    if (iv.start >= from && iv.start < to) count++;
  }

  const span = Math.max(1, to - from);
  return {
    outageMs,
    outageCount: count,
    longestOutageMs: longest,
    availability: Math.max(0, Math.min(1, 1 - outageMs / span)),
    mttrMs: count > 0 ? outageMs / count : 0,
    currentlyOut,
  };
}

// ------------------------- helpers de zona horaria -------------------------

/** Offset (ms) tal que  reloj_de_pared = utc + offset  para la zona `tz`. */
export function tzOffsetMs(ms: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - ms;
}

function shifted(ms: number, tz: string): Date {
  return new Date(ms + tzOffsetMs(ms, tz));
}

export function localDateKey(ms: number, tz: string): string {
  return shifted(ms, tz).toISOString().slice(0, 10);
}

export function localWeekday(ms: number, tz: string): number {
  return shifted(ms, tz).getUTCDay();
}

export function localHour(ms: number, tz: string): number {
  return shifted(ms, tz).getUTCHours();
}

function dayStartMs(dateKey: string, tz: string): number {
  const guess = Date.parse(`${dateKey}T00:00:00.000Z`);
  return guess - tzOffsetMs(guess, tz);
}

function nextDay(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + DAY)
    .toISOString()
    .slice(0, 10);
}

// ------------------------- desgloses -------------------------

export interface DayBucket {
  date: string;
  outageMs: number;
  count: number;
}

export function byDay(
  intervals: Interval[],
  from: number,
  to: number,
  tz: string,
): DayBucket[] {
  const buckets: DayBucket[] = [];
  let key = localDateKey(from, tz);
  let guard = 0;
  while (guard++ < 800) {
    const ds = dayStartMs(key, tz);
    const de = dayStartMs(nextDay(key), tz);
    if (ds >= to) break;
    const lo = Math.max(ds, from);
    const hi = Math.min(de, to);
    let ms = 0;
    let count = 0;
    for (const iv of intervals) {
      const s = Math.max(iv.start, lo);
      const e = Math.min(iv.end, hi);
      if (e > s) ms += e - s;
      if (iv.start >= lo && iv.start < hi) count++;
    }
    buckets.push({ date: key, outageMs: ms, count });
    key = nextDay(key);
  }
  return buckets;
}

export interface WeekdayStat {
  weekday: number; // 0 = domingo
  observedDays: number;
  daysWithOutage: number;
  probability: number;
  avgOutageMs: number;
}

export interface Patterns {
  observedDays: number;
  fromMs: number;
  weekday: WeekdayStat[];
  hour: number[]; // 24 posiciones: cantidad de cortes que empezaron a esa hora
}

export function patterns(
  intervals: Interval[],
  events: HistoryEvent[],
  now: number,
  tz: string,
  lookbackMs = RANGE_MS.quarter,
): Patterns {
  const firstAt = events.length
    ? Math.min(...events.map((e) => e.at))
    : now;
  const from = Math.max(now - lookbackMs, firstAt);
  const days = byDay(intervals, from, now, tz);

  const weekday: WeekdayStat[] = Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    observedDays: 0,
    daysWithOutage: 0,
    probability: 0,
    avgOutageMs: 0,
  }));
  const sumMs = new Array(7).fill(0);

  for (const d of days) {
    const w = localWeekday(dayStartMs(d.date, tz) + 60_000, tz);
    weekday[w].observedDays++;
    sumMs[w] += d.outageMs;
    if (d.count > 0 || d.outageMs > 0) weekday[w].daysWithOutage++;
  }
  for (let i = 0; i < 7; i++) {
    const o = weekday[i].observedDays;
    weekday[i].probability = o ? weekday[i].daysWithOutage / o : 0;
    weekday[i].avgOutageMs = o ? sumMs[i] / o : 0;
  }

  const hour = new Array(24).fill(0);
  for (const iv of intervals) {
    if (iv.start >= from && iv.start <= now) hour[localHour(iv.start, tz)]++;
  }

  return { observedDays: days.length, fromMs: from, weekday, hour };
}

// ------------------------- por dispositivo -------------------------

export interface DeviceStats {
  current: WindowMetrics & { byDay: DayBucket[] };
  previous: WindowMetrics;
  patterns: Patterns;
}

export function computeDeviceStats(
  events: HistoryEvent[],
  now: number,
  tz: string,
  range: RangeKey,
): DeviceStats {
  const intervals = buildOutages(events, now);
  const span = RANGE_MS[range];
  return {
    current: {
      ...windowMetrics(intervals, now - span, now),
      byDay: byDay(intervals, now - span, now, tz),
    },
    previous: windowMetrics(intervals, now - 2 * span, now - span),
    patterns: patterns(intervals, events, now, tz),
  };
}
