import { describe, it, expect } from 'vitest';
import { decodeCCITT } from '../src/pdf/ccitt-decoder';

// CCITT G4: 8 columns × 4 rows, all-white
// 4 × V(0) codes (1 bit each) + EOFB (24 bits) = 28 bits = 4 bytes with 4-bit padding
// Bit layout: 1111 000000000001 000000000001 0000
// Bytes:       0xF0 0x01         0x00 0x10
const ALL_WHITE_8x4_G4 = new Uint8Array([0xF0, 0x01, 0x00, 0x10]);

describe('decodeCCITT', () => {
  it('decodes all-white 8×4 Group4 image with BlackIs1=false', () => {
    const result = decodeCCITT(ALL_WHITE_8x4_G4, {
      K: -1,
      columns: 8,
      rows: 4,
      blackIs1: false,
      encodedByteAlign: false,
    });
    expect(result).toEqual(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]));
  });

  it('decodes all-white 8×4 Group4 image with BlackIs1=true (inverted)', () => {
    const result = decodeCCITT(ALL_WHITE_8x4_G4, {
      K: -1,
      columns: 8,
      rows: 4,
      blackIs1: true,
      encodedByteAlign: false,
    });
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00]));
  });

  it('returns empty Uint8Array for empty input', () => {
    const result = decodeCCITT(new Uint8Array([]), {
      K: -1,
      columns: 8,
      rows: 4,
      blackIs1: false,
      encodedByteAlign: false,
    });
    expect(result.length).toBe(0);
  });
});
