import { BLANK_SHARE, imageStats } from '../check-kit.mjs';

/** Color painted over masked regions, the same in both images so they never differ there. */
const MASK_COLOR = [255, 0, 255, 255];

/** Cells per side of the grid that color sampling reads. */
export const GRID = 8;

export const percent = (ratio) => `${Math.round(ratio * 1000) / 10}%`;

/**
 * A copy of `image` with every mask rectangle that applies to `artifact`
 * painted one flat color. A mask without an `artifact` applies to every
 * image. Returns the image and how many pixels the masks cover.
 */
export function applyMasks(image, masks = [], artifact = null) {
  const applicable = (masks ?? []).filter((mask) => !mask.artifact || mask.artifact === artifact);
  if (applicable.length === 0) return { image, maskedPixels: 0 };
  const { width, height } = image;
  const data = Buffer.from(image.data);
  const covered = new Uint8Array(width * height);
  let maskedPixels = 0;
  for (const mask of applicable) {
    const x0 = Math.max(0, Math.floor(mask.x ?? 0));
    const y0 = Math.max(0, Math.floor(mask.y ?? 0));
    const x1 = Math.min(width, x0 + Math.max(0, Math.floor(mask.width ?? 0)));
    const y1 = Math.min(height, y0 + Math.max(0, Math.floor(mask.height ?? 0)));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = y * width + x;
        if (!covered[index]) {
          covered[index] = 1;
          maskedPixels += 1;
        }
        data.set(MASK_COLOR, index * 4);
      }
    }
  }
  return { image: { ...image, data }, maskedPixels };
}

/** A plain-language name for an RGB color, such as green or near-black. */
export function colorName([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (lightness < 0.12) return 'near-black';
  if (lightness > 0.92) return 'near-white';
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.15) return 'gray';
  let hue;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;
  const names = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [170, 'green'], [200, 'cyan'], [260, 'blue'], [290, 'purple'], [330, 'magenta'], [360, 'red']];
  return names.find(([limit]) => hue < limit)[1];
}

/** The most common color of an image, named, and the share of pixels it holds. */
export function describeImage(image) {
  const stats = imageStats(image);
  return { dominant: colorName(stats.dominant), share: stats.uniformShare, uniform: stats.uniformShare >= BLANK_SHARE };
}

/**
 * The palette of an image: the dominant color of each cell of a GRID by GRID
 * grid, bucketed to four levels per channel, as shares of all cells. Where a
 * color sits does not matter, only how much of the image it covers.
 */
export function palette(image, grid = GRID) {
  const { width, height, data } = image;
  const shares = new Map();
  const cells = grid * grid;
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid; column += 1) {
      const x0 = Math.floor((column * width) / grid);
      const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * width) / grid));
      const y0 = Math.floor((row * height) / grid);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / grid));
      const counts = new Map();
      for (let y = y0; y < Math.min(y1, height); y += 1) {
        for (let x = x0; x < Math.min(x1, width); x += 1) {
          const index = (y * width + x) * 4;
          const key = ((data[index] >> 6) << 4) | ((data[index + 1] >> 6) << 2) | (data[index + 2] >> 6);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      let top = 0;
      let topCount = -1;
      for (const [key, count] of counts) {
        if (count > topCount) {
          top = key;
          topCount = count;
        }
      }
      shares.set(top, (shares.get(top) ?? 0) + 1 / cells);
    }
  }
  return shares;
}

/** How far apart two palettes are, from 0 (the same colors in the same amounts) to 1 (no color in common). */
export function paletteDistance(left, right) {
  let shared = 0;
  for (const [key, share] of left) shared += Math.min(share, right.get(key) ?? 0);
  return Math.max(0, Math.min(1, 1 - shared));
}
