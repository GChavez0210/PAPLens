/**
 * Small info marker with a hover/focus tooltip (pure CSS via data-tip).
 * Keyboard accessible: focusable, and the text doubles as the aria-label.
 */
export function InfoTip({ text }) {
  return (
    <span className="info-tip" tabIndex={0} data-tip={text} aria-label={text}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>
  );
}
