"use client";

export interface Bar {
  label: string;
  value: number;
  tip: string;
}

/**
 * Micrografico de barras en SVG inline. Una sola tonalidad (magnitud), barras
 * finas ancladas a la linea base, opacidad segun valor, tooltip nativo por barra
 * y etiqueta directa solo en la barra mayor.
 */
export default function MiniBars({
  bars,
  height = 68,
  hue = "var(--off)",
  valueLabel = (v: number) => String(v),
  labelEvery = 1,
}: {
  bars: Bar[];
  height?: number;
  hue?: string;
  valueLabel?: (v: number) => string;
  labelEvery?: number;
}) {
  const n = bars.length;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const W = 320;
  const H = height;
  const padB = 16; // espacio para etiquetas del eje x
  const padT = 12; // espacio para la etiqueta directa
  const slot = W / n;
  const barW = Math.max(2, Math.min(slot - 2, 14));
  const plotH = H - padB - padT;
  const maxIdx = bars.reduce((mi, b, i) => (b.value > bars[mi].value ? i : mi), 0);

  return (
    <svg
      className="minibars"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
    >
      {/* linea base */}
      <line
        x1="0"
        x2={W}
        y1={H - padB}
        y2={H - padB}
        stroke="var(--border)"
        strokeWidth="1"
      />
      {bars.map((b, i) => {
        const h = b.value > 0 ? Math.max(2, (b.value / max) * plotH) : 0;
        const x = i * slot + (slot - barW) / 2;
        const y = H - padB - h;
        const op = 0.4 + 0.6 * (b.value / max);
        const showLabel = i === maxIdx && b.value > 0;
        const showTick = i % labelEvery === 0 || i === n - 1;
        return (
          <g key={i}>
            {h > 0 && (
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="3"
                fill={hue}
                fillOpacity={op}
              >
                <title>{b.tip}</title>
              </rect>
            )}
            {showLabel && (
              <text
                x={i * slot + slot / 2}
                y={y - 4}
                textAnchor="middle"
                className="mb-val"
              >
                {valueLabel(b.value)}
              </text>
            )}
            {showTick && (
              <text
                x={i * slot + slot / 2}
                y={H - 4}
                textAnchor="middle"
                className="mb-tick"
              >
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
