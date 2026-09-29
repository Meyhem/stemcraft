/**
 * A <canvas> cannot resolve `var(--ds-x)`: it ignores the invalid colour and fills black,
 * which on this ground is invisible. So a token is resolved to its concrete value here,
 * from the computed style, which keeps tokens.css the single authority (U-02) rather than
 * copying a hex into TSX.
 */
export function resolveColor(cssVar: string, fallbackToken = '--ds-text-2'): string {
  // Read from :root, where tokens.css defines every token.
  const root = getComputedStyle(document.documentElement);
  const name = /^var\((--[\w-]+)\)$/.exec(cssVar)?.[1];
  const value = name ? root.getPropertyValue(name).trim() : '';
  // N-08: an unresolved token is not silently black. Fall back to a colour that is legible
  // on every surface.
  return value || root.getPropertyValue(fallbackToken).trim() || cssVar;
}
