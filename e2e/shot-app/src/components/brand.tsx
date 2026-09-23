/**
 * The mark.
 *
 * A registration mark, the crosshair a print shop puts in the margin to prove
 * the plates line up. It is the whole product in one glyph: this line and
 * that source are in register, or they are not. Drawn rather than imported so
 * it inherits currentColor and stays crisp at 16px.
 */

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.35"
      />
      <path d="M12 4.5v15M4.5 12h15" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />
      <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />
      <circle cx="12" cy="12" r="1.9" fill="var(--stamp)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <Mark className="size-[1.375rem] shrink-0 text-ink" />
      <span className="text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
        Tailor
      </span>
    </span>
  );
}
