import pixelmatch from 'pixelmatch';
import { describeImage, percent } from './shared.mjs';

/** Share of pixels that must change between two frames for the subject to count as moving. */
export const MOTION_THRESHOLD = 0.005;

/** A live capture is not uniform: a black, white, or empty view fails. No baseline is needed. */
export function checkLiveness(current) {
  const { dominant, share, uniform } = describeImage(current);
  return {
    method: 'liveness',
    ok: !uniform,
    dominant,
    detail: uniform ? `the capture is uniform: ${percent(share)} of it is ${dominant}` : `${percent(share)} of the capture shares its most common color, ${dominant}`,
  };
}

/** Two frames of a moving subject, taken some time apart, must differ. */
export function checkMotion(first, second, { minimum = MOTION_THRESHOLD } = {}) {
  if (first.width !== second.width || first.height !== second.height) {
    return { method: 'motion', ok: false, ratio: 0, detail: `the frames differ in size: ${first.width}x${first.height} and ${second.width}x${second.height}` };
  }
  const changed = pixelmatch(first.data, second.data, null, first.width, first.height, { threshold: 0.1, includeAA: true });
  const ratio = changed / (first.width * first.height);
  return {
    method: 'motion',
    ok: ratio > minimum,
    ratio,
    detail: ratio > minimum ? `${percent(ratio)} of pixels changed between the frames` : `the frames are the same: ${percent(ratio)} of pixels changed`,
  };
}
