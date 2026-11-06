// The mark: a receipt with a torn edge (the invoice) and a double chevron running out of it (the chase).
// Same geometry as the favicon in index.html and app.mjs.
export const RECEIPT = 'M8 4h16a2 2 0 0 1 2 2v20l-4-2.5-4 2.5-4-2.5-4 2.5-4-2.5V6a2 2 0 0 1 2-2z';

export function LogoMark({ size = 28, tile = '#2b0e94', paper = '#fefefe', ink = '#2b0e94', accent = '#ad2b9d' }: { size?: number; tile?: string; paper?: string; ink?: string; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="shrink-0">
      <rect width="32" height="32" rx="9" fill={tile} />
      <path d={RECEIPT} fill={paper} />
      <rect x="10" y="9" width="9" height="2.2" rx="1.1" fill={ink} />
      <rect x="10" y="13.5" width="5" height="2.2" rx="1.1" fill={ink} opacity="0.55" />
      <path d="M15.5 16.5l3 2.6-3 2.6M20 16.5l3 2.6-3 2.6" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`ic-display text-[15px] font-black lowercase tracking-tight ${className}`}>
      invoice<span className="text-[#f08ae6]">chaser</span>
    </span>
  );
}
