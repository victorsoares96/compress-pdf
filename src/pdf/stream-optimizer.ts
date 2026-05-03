import { deflateSync, inflateSync } from 'zlib';

/**
 * Recompresses a FlateDecode stream at zlib level 9.
 * Returns recompressed bytes if smaller than input, null otherwise.
 */
export function optimizeFlateStream(compressed: Uint8Array): Uint8Array | null {
  try {
    const decompressed = inflateSync(compressed);
    const recompressed = deflateSync(decompressed, { level: 9 });
    if (recompressed.length < compressed.length) {
      return recompressed;
    }
    return null;
  } catch {
    return null;
  }
}
