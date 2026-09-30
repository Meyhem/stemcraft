import type { Blob } from './blobs';

export type Rgb = readonly [number, number, number];

/**
 * A gradient stop needs the stem colour at several opacities, which a resolved
 * token string cannot give. tokens.css defines the stem hues as #RRGGBB
 * (paint.test.ts holds it to that), so that is the only form read here.
 */
export function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!match) return null;
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

/** `colors` is STEM_ORDER-indexed. Glows add where they overlap, which is the blend. */
export function paintBlobs(
  ctx: CanvasRenderingContext2D,
  blobs: readonly Blob[],
  colors: readonly Rgb[],
  width: number,
  height: number,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';
  for (const blob of blobs) {
    const [r, g, b] = colors[blob.stem]!;
    const left = blob.center - blob.radius;
    const gradient = ctx.createLinearGradient(left, 0, blob.center + blob.radius, 0);
    gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
    gradient.addColorStop(0.5, `rgba(${r},${g},${b},${blob.alpha.toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(left, 0, blob.radius * 2, height);
  }
}
