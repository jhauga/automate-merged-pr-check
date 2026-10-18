import pixelmatch from 'pixelmatch';
import { writeImage } from '../check-kit.mjs';
import { applyMasks, percent } from './shared.mjs';

/** How different two pixels must be, in pixelmatch's own scale, to count as changed. */
const PIXEL_TOLERANCE = 0.1;

/** Default share of pixels that may differ before a pixel comparison fails. */
export const PIXEL_THRESHOLD = 0.01;

/**
 * Compares two captures pixel by pixel. `threshold` is the share of unmasked
 * pixels allowed to differ. Images of different sizes fail. With `diffFile`,
 * a failing comparison writes an image that marks the changed pixels.
 */
export function comparePixels(baseline, current, { threshold = PIXEL_THRESHOLD, masks = [], artifact = null, diffFile = null } = {}) {
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      method: 'pixel',
      ok: false,
      ratio: 1,
      detail: `the capture is ${current.width}x${current.height} where the baseline is ${baseline.width}x${baseline.height}`,
    };
  }
  const { width, height } = current;
  const left = applyMasks(baseline, masks, artifact);
  const right = applyMasks(current, masks, artifact);
  const output = diffFile ? Buffer.alloc(width * height * 4) : null;
  const changed = pixelmatch(left.image.data, right.image.data, output, width, height, { threshold: PIXEL_TOLERANCE });
  const counted = width * height - right.maskedPixels;
  const ratio = counted > 0 ? changed / counted : 0;
  const ok = ratio <= threshold;
  if (!ok && diffFile) writeImage(diffFile, { width, height, data: output });
  return {
    method: 'pixel',
    ok,
    ratio,
    detail: `${percent(ratio)} of pixels differ from the baseline (allowed ${percent(threshold)})`,
    ...(!ok && diffFile ? { diffFile } : {}),
  };
}
