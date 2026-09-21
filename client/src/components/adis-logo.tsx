import logoUrl from "@/assets/adis-logo.jpg";

export function AdisLogo({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="Abu Dhabi Irish Society"
      className={className}
      data-testid="img-adis-logo"
    />
  );
}

export function AdisHarpMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 160"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M32 150c-10 0-16-8-16-16 0-10 8-14 8-14"
        stroke="#fe0000"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M24 120C18 100 20 60 34 30 44 10 62 4 78 8"
        stroke="#fe0000"
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M78 8c14 3 24 12 26 24"
        stroke="#2e973a"
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M78 8L34 140h20L92 32c2-9-4-17-14-24z" fill="#111" />
      <g stroke="#111" strokeWidth="3">
        <line x1="46" y1="40" x2="70" y2="34" />
        <line x1="43" y1="58" x2="69" y2="50" />
        <line x1="40" y1="76" x2="68" y2="66" />
        <line x1="37" y1="94" x2="67" y2="82" />
        <line x1="35" y1="112" x2="66" y2="98" />
      </g>
    </svg>
  );
}
