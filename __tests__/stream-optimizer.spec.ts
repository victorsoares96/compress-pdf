import { deflateSync, inflateSync } from 'zlib';
import { optimizeFlateStream } from '../src/pdf/stream-optimizer';

function makeCompressibleData(size: number): Uint8Array {
  return new Uint8Array(Array.from({ length: size }, (_, i) => i % 32));
}

describe('optimizeFlateStream', () => {
  it('returns a smaller buffer for compressible data', () => {
    const raw = makeCompressibleData(4096);
    const poorlyCompressed = deflateSync(raw, { level: 1 });

    const result = optimizeFlateStream(poorlyCompressed);

    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThan(poorlyCompressed.length);
    expect(inflateSync(result!)).toEqual(Buffer.from(raw));
  });

  it('returns null when recompressed size is not smaller', () => {
    const raw = makeCompressibleData(100);
    const alreadyOptimal = deflateSync(raw, { level: 9 });

    const result = optimizeFlateStream(alreadyOptimal);

    expect(result).toBeNull();
  });

  it('returns null for invalid deflate bytes', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    const result = optimizeFlateStream(garbage);
    expect(result).toBeNull();
  });
});
