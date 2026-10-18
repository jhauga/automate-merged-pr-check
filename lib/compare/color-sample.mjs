import { applyMasks, describeImage, palette, paletteDistance, percent } from './shared.mjs';

/** Default palette distance at which a color comparison fails. */
export const COLOR_THRESHOLD = 0.25;

/**
 * Compares the colors of two captures without regard to where they sit, for
 * subjects whose layout changes every run but whose palette does not. A
 * uniform capture, such as a black view, always fails.
 */
export function compareColors(baseline, current, { threshold = COLOR_THRESHOLD, masks = [], artifact = null } = {}) {
  const now = describeImage(current);
  const then = describeImage(baseline);
  if (now.uniform) {
    return {
      method: 'color-sample',
      ok: false,
      distance: 1,
      dominant: now.dominant,
      baselineDominant: then.dominant,
      detail: `the capture is uniform: ${percent(now.share)} of it is ${now.dominant}, where the baseline is mostly ${then.dominant}`,
    };
  }
  const distance = paletteDistance(palette(applyMasks(baseline, masks, artifact).image), palette(applyMasks(current, masks, artifact).image));
  return {
    method: 'color-sample',
    ok: distance <= threshold,
    distance,
    dominant: now.dominant,
    baselineDominant: then.dominant,
    detail: `palette distance ${distance.toFixed(2)} from the baseline (allowed ${threshold}); mostly ${now.dominant}, where the baseline is mostly ${then.dominant}`,
  };
}
