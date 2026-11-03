/**
 * The Mooring mark: a double-bitt mooring bollard whose rope draws the "M".
 * Decorative next to the wordmark (`aria-hidden`); the rope is always amber.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="14" y="26" width="20" height="62" rx="10" fill="#f2eee4" />
      <rect x="66" y="26" width="20" height="62" rx="10" fill="#f2eee4" />
      <rect x="10" y="20" width="28" height="13" rx="6.5" fill="#f2eee4" />
      <rect x="62" y="20" width="28" height="13" rx="6.5" fill="#f2eee4" />
      <path d="M28 36 L 50 80 L 72 36" stroke="#f2b44a" strokeWidth="10" />
    </svg>
  );
}
