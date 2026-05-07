import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inflateSync } from 'zlib';

vi.mock('../src/pdf/ccitt-decoder', () => ({
  decodeCCITT: vi.fn(),
}));

// eslint-disable-next-line import/first
import { optimizeCCITTStream } from '../src/pdf/ccitt-optimizer';
// eslint-disable-next-line import/first
import { decodeCCITT } from '../src/pdf/ccitt-decoder';

const mockDecode = vi.mocked(decodeCCITT);
const BASE_PARAMS = {
  K: -1,
  columns: 100,
  rows: 100,
  blackIs1: false,
  encodedByteAlign: false,
};

function makeBitmap(rows: number, cols: number): Uint8Array {
  return new Uint8Array(rows * Math.ceil(cols / 8)); // all zeros = all white
}

describe('optimizeCCITTStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when decoder throws (corrupt stream falls through safely)', () => {
    mockDecode.mockImplementation(() => {
      throw new Error('corrupt data');
    });

    const result = optimizeCCITTStream(new Uint8Array(10), BASE_PARAMS, {
      targetDpi: 150,
      currentWidthPx: 100,
      pageWidthPt: 612,
    });

    expect(result).toBeNull();
  });

  it('downsamples 300 DPI image to 150 DPI (scale 0.5) when targetDpi=150', () => {
    // currentDpi = 2550px / (612pt / 72) = 2550 / 8.5 = 300 DPI → scale 0.5
    const bitmap = makeBitmap(3300, 2550);
    mockDecode.mockReturnValue(bitmap);

    const params = {
      K: -1,
      columns: 2550,
      rows: 3300,
      blackIs1: false,
      encodedByteAlign: false,
    };
    // largeInput ensures deflated bitmap (small) wins the size comparison
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 150,
      currentWidthPx: 2550,
      pageWidthPt: 612,
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBe(1275); // 2550 × 0.5
    expect(result!.height).toBe(1650); // 3300 × 0.5
  });

  it('enforces 150 DPI floor: targetDpi=72 still only downsamples to 150', () => {
    const bitmap = makeBitmap(3300, 2550);
    mockDecode.mockReturnValue(bitmap);

    const params = {
      K: -1,
      columns: 2550,
      rows: 3300,
      blackIs1: false,
      encodedByteAlign: false,
    };
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 72, // screen preset — floor must apply
      currentWidthPx: 2550,
      pageWidthPt: 612,
    });

    // effectiveDpi = max(72, 150) = 150 → scale = 150/300 = 0.5 (same as targetDpi=150)
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1275);
    expect(result!.height).toBe(1650);
  });

  it('does not downsample when currentDpi is already at or below effectiveDpi', () => {
    // currentDpi = 1275 / 8.5 = 150 DPI → effectiveDpi=150 → no downsampling
    const bitmap = makeBitmap(1650, 1275);
    mockDecode.mockReturnValue(bitmap);

    const params = {
      K: -1,
      columns: 1275,
      rows: 1650,
      blackIs1: false,
      encodedByteAlign: false,
    };
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 150,
      currentWidthPx: 1275,
      pageWidthPt: 612,
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBe(1275); // unchanged
    expect(result!.height).toBe(1650); // unchanged
  });

  it('downsample1Bit: majority vote produces correct pixel values', () => {
    // 4 columns × 2 rows: 1 byte per row = 2 bytes total
    // 0xC0 = 1100 0000: pixels 0,1 are black; pixels 2,3 are white
    const bitmap4x2 = new Uint8Array([0xC0, 0xC0]);
    mockDecode.mockReturnValue(bitmap4x2);

    // currentDpi = 2550 / (612/72) = 300 → scale=0.5 → 4×2 becomes 2×1
    const params = { K: -1, columns: 4, rows: 2, blackIs1: false, encodedByteAlign: false };
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 150,
      currentWidthPx: 2550,
      pageWidthPt: 612,
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(1);

    // Decompress FlateDecode output to inspect pixels
    const decompressed = inflateSync(result!.data);
    // 2 columns × 1 row = 1 byte (ceil(2/8))
    expect(decompressed.length).toBe(1);
    // Pixel 0 (bit 7): black — majority of src pixels 0,1 from rows 0,1 = all black
    expect((decompressed[0] >> 7) & 1).toBe(1);
    // Pixel 1 (bit 6): white — majority of src pixels 2,3 from rows 0,1 = all white
    expect((decompressed[0] >> 6) & 1).toBe(0);
  });

  it('returns null when FlateDecode result is not smaller than original stream', () => {
    // Tiny bitmap; deflated output will be larger than 1-byte "original"
    const bitmap = makeBitmap(4, 8);
    mockDecode.mockReturnValue(bitmap);

    const result = optimizeCCITTStream(new Uint8Array(1), BASE_PARAMS, {
      targetDpi: 150,
      currentWidthPx: 100,
      pageWidthPt: 612,
    });

    expect(result).toBeNull();
  });
});
