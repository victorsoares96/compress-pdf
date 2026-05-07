import { deflateSync } from 'zlib';
import { decodeCCITT, type CCITTParams } from './ccitt-decoder';
import { CCITT_MIN_DPI } from './presets';

export interface OptimizeCCITTOptions {
  targetDpi: number;
  currentWidthPx: number;
  currentHeightPx: number;
  pageWidthPt?: number;
}

export interface CCITTOptimizeResult {
  data: Uint8Array;
  width: number;
  height: number;
}

// eslint-disable-next-line no-bitwise
function getBit(src: Uint8Array, rowOffset: number, x: number): number {
  // eslint-disable-next-line no-bitwise
  return (src[rowOffset + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
}

function setBit(dst: Uint8Array, rowOffset: number, x: number): void {
  // eslint-disable-next-line no-param-reassign, no-bitwise
  dst[rowOffset + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
}

function downsample1Bit(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Uint8Array {
  const srcRowBytes = Math.ceil(srcWidth / 8);
  const dstRowBytes = Math.ceil(dstWidth / 8);
  const dst = new Uint8Array(dstRowBytes * dstHeight);

  for (let dy = 0; dy < dstHeight; dy += 1) {
    const srcY0 = Math.floor((dy * srcHeight) / dstHeight);
    const srcY1 = Math.floor(((dy + 1) * srcHeight) / dstHeight);

    for (let dx = 0; dx < dstWidth; dx += 1) {
      const srcX0 = Math.floor((dx * srcWidth) / dstWidth);
      const srcX1 = Math.floor(((dx + 1) * srcWidth) / dstWidth);

      let black = 0;
      let total = 0;
      for (let sy = srcY0; sy < srcY1; sy += 1) {
        const srcRow = sy * srcRowBytes;
        for (let sx = srcX0; sx < srcX1; sx += 1) {
          const bit = getBit(src, srcRow, sx);
          if (bit) black += 1;
          total += 1;
        }
      }

      if (total > 0 && black * 2 > total) {
        setBit(dst, dy * dstRowBytes, dx);
      }
    }
  }

  return dst;
}

export function optimizeCCITTStream(
  data: Uint8Array,
  params: CCITTParams,
  options: OptimizeCCITTOptions
): CCITTOptimizeResult | null {
  let bitmap: Uint8Array;
  try {
    bitmap = decodeCCITT(data, params);
  } catch {
    return null;
  }

  let width = params.columns;
  let height = params.rows;

  if (
    options.pageWidthPt &&
    options.pageWidthPt > 0 &&
    options.currentWidthPx > 0
  ) {
    const pageWidthInches = options.pageWidthPt / 72;
    const currentDpi = options.currentWidthPx / pageWidthInches;
    const effectiveDpi = Math.max(options.targetDpi, CCITT_MIN_DPI);

    if (currentDpi > effectiveDpi) {
      const scale = effectiveDpi / currentDpi;
      const newWidth = Math.max(1, Math.round(width * scale));
      const newHeight = Math.max(1, Math.round(height * scale));
      bitmap = downsample1Bit(bitmap, width, height, newWidth, newHeight);
      width = newWidth;
      height = newHeight;
    }
  }

  const compressed = deflateSync(bitmap, { level: 9 });
  if (compressed.length >= data.length) return null;

  return { data: compressed, width, height };
}
