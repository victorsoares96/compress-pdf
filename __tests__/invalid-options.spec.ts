import { describe, expect, it } from 'vitest';
import compress from '../src/compress';

describe('compress option validation', () => {
  it('rejects a non-finite imageQuality before calling Ghostscript', async () => {
    await expect(
      compress('unused.pdf', { imageQuality: Number.NaN })
    ).rejects.toThrow(/imageQuality/);
  });

  it('rejects a non-finite compatibilityLevel before calling Ghostscript', async () => {
    await expect(
      compress('unused.pdf', { compatibilityLevel: Number.NaN })
    ).rejects.toThrow(/compatibilityLevel/);
  });
});
