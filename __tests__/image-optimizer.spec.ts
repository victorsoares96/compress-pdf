import { optimizeJpegStream } from '../src/pdf/image-optimizer';

// Minimal valid 1x1 white JPEG pixel (pre-generated, valid JPEG bytes)
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC' +
  'AABAAEDASIAAREBAXEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAA' +
  'AAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/' +
  'aAAwDAQACEQMRAD8AJQAB/9k=',
  'base64'
);

describe('optimizeJpegStream', () => {
  it('returns null for invalid JPEG bytes', async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const result = await optimizeJpegStream(garbage, {
      targetDpi: 72,
      jpegQuality: 50,
      currentWidthPx: 100,
      currentHeightPx: 100,
    });
    expect(result).toBeNull();
  });

  it('accepts valid JPEG and returns null or Uint8Array (no crash)', async () => {
    const input = new Uint8Array(TINY_JPEG);
    const result = await optimizeJpegStream(input, {
      targetDpi: 72,
      jpegQuality: 50,
      currentWidthPx: 1,
      currentHeightPx: 1,
    });
    // Either returns optimized bytes or null — both are valid
    expect(result === null || result instanceof Uint8Array).toBe(true);
  });

  it('does not throw for any input', async () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([0xff, 0xd8]), // partial JPEG header
      new Uint8Array(TINY_JPEG),
    ];
    for (const input of cases) {
      await expect(
        optimizeJpegStream(input, {
          targetDpi: 150,
          jpegQuality: 65,
          currentWidthPx: 1,
          currentHeightPx: 1,
        })
      ).resolves.not.toThrow();
    }
  });
}, { timeout: 30000 });
