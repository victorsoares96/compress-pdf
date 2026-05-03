import { getJpegDecoder, getJpegEncoder, getResizer } from '../wasm/loader';

export interface ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface OptimizeJpegOptions {
  targetDpi: number;
  jpegQuality: number;
  currentWidthPx: number;
  currentHeightPx: number;
  pageWidthPt?: number;
}

/**
 * Decodes a JPEG stream, optionally downsamples it, re-encodes at target quality.
 * Returns new JPEG bytes or null on any failure.
 */
export async function optimizeJpegStream(
  jpegBytes: Uint8Array,
  options: OptimizeJpegOptions
): Promise<Uint8Array | null> {
  if (jpegBytes.length === 0) return null;

  try {
    const decode = await getJpegDecoder();
    const encode = await getJpegEncoder();
    const resize = await getResizer();

    const buffer = jpegBytes.buffer.slice(
      jpegBytes.byteOffset,
      jpegBytes.byteOffset + jpegBytes.byteLength
    ) as ArrayBuffer;

    const imageData = await decode(buffer);

    let processed: ImageData = imageData;

    if (options.pageWidthPt && options.pageWidthPt > 0 && options.currentWidthPx > 0) {
      const pageWidthInches = options.pageWidthPt / 72;
      const currentDpi = options.currentWidthPx / pageWidthInches;

      if (currentDpi > options.targetDpi) {
        const scale = options.targetDpi / currentDpi;
        const newWidth = Math.max(1, Math.round(imageData.width * scale));
        const newHeight = Math.max(1, Math.round(imageData.height * scale));

        if (newWidth < imageData.width) {
          processed = await resize(imageData, { width: newWidth, height: newHeight });
        }
      }
    }

    const encoded = await encode(processed, { quality: options.jpegQuality });
    return new Uint8Array(encoded);
  } catch {
    return null;
  }
}
