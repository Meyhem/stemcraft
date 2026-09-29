// Inline SVG, not the ▶ / ⏸ characters: those are emoji-presentation glyphs on most
// platforms and render as a coloured pictograph that ignores the theme.
const common = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'currentColor', 'aria-hidden': true } as const;

export function PlayIcon() {
  return (
    <svg {...common}>
      <path d="M3 1.5v11l9-5.5z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg {...common}>
      <path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" />
    </svg>
  );
}
