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
  it('omits image flags for printer, prepress, and default when imageQuality is omitted', () => {
    for (const resolution of ['printer', 'prepress', 'default']) {
      const args = buildGsArgs({ ...base, resolution });
      expect(imageFlags(args)).toEqual([]);
      expect(args).toContain(`-dPDFSETTINGS=/${resolution}`);
    }
  });

  it('downsamples only monochrome images to 150 DPI for ebook and screen', () => {
    for (const resolution of ['ebook', 'screen']) {
      const args = buildGsArgs({ ...base, resolution });
      expect(imageFlags(args)).toEqual([
        '-dMonoImageDownsampleType=/Subsample',
        '-dMonoImageResolution=150',
      ]);
    }
  });

  it('applies imageQuality to color, gray, and monochrome images', () => {
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
