import { describe, expect, it } from 'vitest';
import { buildGsArgs } from '../src/compress';

const base = {
  output: '/tmp/out.pdf',
  inputFile: '/tmp/in.pdf',
  compatibilityLevel: 1.4,
  resolution: 'printer',
  pdfPassword: '',
  removePasswordAfterCompression: false,
};

function imageFlags(args: string[]): string[] {
  return args.filter(
    (arg) =>
      arg.includes('ImageResolution') || arg.includes('ImageDownsampleType')
  );
}

describe('buildGsArgs image resolution', () => {
  it('omits resolution flags when imageQuality is omitted', () => {
    const args = buildGsArgs(base);
    expect(imageFlags(args)).toEqual([]);
    expect(args).toContain('-dPDFSETTINGS=/printer');
  });

  it('emits DPI flags only when imageQuality is set', () => {
    const args = buildGsArgs({ ...base, imageQuality: 300 });
    expect(args).toEqual(
      expect.arrayContaining([
        '-dColorImageDownsampleType=/Bicubic',
        '-dColorImageResolution=300',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dGrayImageResolution=300',
        '-dMonoImageDownsampleType=/Subsample',
        '-dMonoImageResolution=300',
      ])
    );
  });
});
