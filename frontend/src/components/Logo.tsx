export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="bvg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <filter id="bvglow"><feGaussianBlur stdDeviation="1.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <g filter="url(#bvglow)">
        <circle cx="32" cy="12" r="6.5" fill="url(#bvg)" />
        <path d="M6 20c9 5 17 7.5 26 7.5S49 25 58 20c-7 9-13.5 13.5-18 15.5l4.5 22h-7L33 41.5 28.5 57.5h-7l4.5-22C21.5 33.5 13 29 6 20z" fill="url(#bvg)" />
      </g>
    </svg>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <LogoMark />
      {!compact && (
        <div className="brand-text-wrap">
          <div className="brand-text">BODY<b>VISION</b> AI</div>
          <div className="brand-sub">Análisis · Simulación</div>
        </div>
      )}
    </div>
  )
}
