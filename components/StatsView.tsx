"use client";

import { useCallback, useEffect, useState } from "react";
import MiniBars, { type Bar } from "./MiniBars";

type RangeKey = "day" | "week" | "month" | "quarter" | "year";

const RANGE_LABEL: Record<RangeKey, string> = {
  day: "Día",
  week: "Semana",
  month: "Mes",
  quarter: "90 días",
  year: "Año",
};
const PREV_LABEL: Record<RangeKey, string> = {
  day: "el día anterior",
  week: "la semana anterior",
  month: "el mes anterior",
  quarter: "los 90 días previos",
  year: "el año anterior",
};
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

interface WindowMetrics {
  outageMs: number;
  outageCount: number;
  longestOutageMs: number;
  availability: number;
  mttrMs: number;
  currentlyOut: boolean;
}
interface DeviceStat {
  id: string;
  name: string;
  events: number;
  current: WindowMetrics & { byDay: { date: string; outageMs: number; count: number }[] };
  previous: WindowMetrics;
  patterns: {
    observedDays: number;
    weekday: {
      weekday: number;
      observedDays: number;
      daysWithOutage: number;
      probability: number;
      avgOutageMs: number;
    }[];
    hour: number[];
  };
}
interface StatsResponse {
  range: RangeKey;
  devices: DeviceStat[];
  ranking: {
    mostOutageTime?: string;
    leastOutageTime?: string;
    mostOutages?: string;
    bestAvailability?: string;
    worstAvailability?: string;
  } | null;
  totals: {
    outageMs: number;
    outageCount: number;
    prevOutageMs: number;
    prevOutageCount: number;
    availability: number;
  };
}

function fmtDur(ms: number): string {
  if (ms < 1000) return "0";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}
const pct = (x: number) => `${(x * 100).toFixed(x > 0.999 ? 2 : 1)}%`;

function Delta({ cur, prev, range }: { cur: number; prev: number; range: RangeKey }) {
  const diff = cur - prev;
  if (prev === 0 && cur === 0)
    return <span className="delta flat">sin cambios vs {PREV_LABEL[range]}</span>;
  const up = diff > 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {fmtDur(Math.abs(diff))} {up ? "más" : "menos"} que{" "}
      {PREV_LABEL[range]}
    </span>
  );
}

export default function StatsView() {
  const [range, setRange] = useState<RangeKey>("month");
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?range=${r}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as StatsResponse);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const nameOf = (id?: string) =>
    data?.devices.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="stats">
      <div className="range-row">
        {(Object.keys(RANGE_LABEL) as RangeKey[]).map((r) => (
          <button
            key={r}
            className={r === range ? "sm chip active" : "sm chip"}
            onClick={() => setRange(r)}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {error && <p className="err">No se pudieron cargar las estadísticas.</p>}
      {loading && !data && <p className="muted">Calculando…</p>}

      {data && data.devices.length === 0 && (
        <p className="hint">Todavía no hay dispositivos con datos.</p>
      )}

      {data && data.devices.length > 0 && (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="tile-k">Sin luz ({RANGE_LABEL[range].toLowerCase()})</span>
              <span className="tile-v">{fmtDur(data.totals.outageMs)}</span>
              <Delta
                cur={data.totals.outageMs}
                prev={data.totals.prevOutageMs}
                range={range}
              />
            </div>
            <div className="tile">
              <span className="tile-k">Cortes</span>
              <span className="tile-v">{data.totals.outageCount}</span>
              <span className="delta flat">
                {data.totals.prevOutageCount} en {PREV_LABEL[range]}
              </span>
            </div>
            <div className="tile">
              <span className="tile-k">Disponibilidad</span>
              <span className="tile-v">{pct(data.totals.availability)}</span>
              <span className="delta flat">promedio de todos los lugares</span>
            </div>
          </div>

          {data.ranking && (
            <div className="card ranking">
              <div>
                <span className="muted">Más se corta</span>
                <b>{nameOf(data.ranking.mostOutageTime)}</b>
              </div>
              <div>
                <span className="muted">Menos se corta</span>
                <b>{nameOf(data.ranking.leastOutageTime)}</b>
              </div>
              <div>
                <span className="muted">Más cortes</span>
                <b>{nameOf(data.ranking.mostOutages)}</b>
              </div>
              <div>
                <span className="muted">Mejor disponibilidad</span>
                <b>{nameOf(data.ranking.bestAvailability)}</b>
              </div>
            </div>
          )}

          {data.devices.map((d) => (
            <DeviceStatsCard key={d.id} d={d} range={range} />
          ))}
        </>
      )}
    </div>
  );
}

function DeviceStatsCard({ d, range }: { d: DeviceStat; range: RangeKey }) {
  const dayBars: Bar[] = d.current.byDay.map((b) => ({
    label: b.date.slice(8, 10),
    value: Math.round(b.outageMs / 60000),
    tip: `${b.date}: ${fmtDur(b.outageMs)} sin luz · ${b.count} corte(s)`,
  }));
  const labelEvery = Math.max(1, Math.round(dayBars.length / 8));

  const wdBars: Bar[] = d.patterns.weekday.map((w) => ({
    label: WEEKDAYS[w.weekday],
    value: Math.round(w.probability * 100),
    tip: `${WEEKDAYS[w.weekday]}: ${(w.probability * 100).toFixed(0)}% de los días hubo corte (${w.daysWithOutage}/${w.observedDays}) · ${fmtDur(w.avgOutageMs)} promedio`,
  }));

  const hourBars: Bar[] = d.patterns.hour.map((c, h) => ({
    label: h % 6 === 0 ? String(h) : "",
    value: c,
    tip: `${String(h).padStart(2, "0")}:00 – ${c} corte(s) empezaron en esta hora`,
  }));

  const peakWd = [...d.patterns.weekday].sort(
    (a, b) => b.probability - a.probability,
  )[0];

  return (
    <div className="card devstat">
      <div className="devstat-head">
        <b>{d.name}</b>
        <span className={d.current.currentlyOut ? "badge off" : "badge"}>
          {d.current.currentlyOut ? "sin luz ahora" : pct(d.current.availability)}
        </span>
      </div>
      <div className="devstat-meta">
        <span>{fmtDur(d.current.outageMs)} sin luz</span>
        <span>·</span>
        <span>{d.current.outageCount} cortes</span>
        <span>·</span>
        <span>peor: {fmtDur(d.current.longestOutageMs)}</span>
        <span>·</span>
        <span>recuperación media {fmtDur(d.current.mttrMs)}</span>
      </div>

      <p className="chart-title">Minutos sin luz por día</p>
      <MiniBars
        bars={dayBars}
        labelEvery={labelEvery}
        valueLabel={(v) => `${v}m`}
      />

      <p className="chart-title">
        Probabilidad de corte por día de la semana
        <span className="muted"> · {d.patterns.observedDays} días observados</span>
      </p>
      <MiniBars bars={wdBars} hue="var(--off)" valueLabel={(v) => `${v}%`} />
      {peakWd && peakWd.probability > 0 && (
        <p className="muted">
          Los <b>{WEEKDAYS[peakWd.weekday]}</b> es cuando más se corta:{" "}
          {(peakWd.probability * 100).toFixed(0)}% de las veces.
        </p>
      )}

      <p className="chart-title">Cortes por hora del día</p>
      <MiniBars bars={hourBars} labelEvery={1} valueLabel={(v) => String(v)} />

      {d.patterns.observedDays < 14 && (
        <p className="muted">
          Pocos datos aún: las probabilidades se afinan con las semanas.
        </p>
      )}
    </div>
  );
}
