import { getPreset, applyOptions } from '../src/pdf/presets';

describe('getPreset', () => {
  it('returns correct values for screen', () => {
    expect(getPreset('screen')).toEqual({ dpi: 72, jpegQuality: 35 });
  });

  it('returns correct values for ebook', () => {
    expect(getPreset('ebook')).toEqual({ dpi: 150, jpegQuality: 65 });
  });

  it('returns correct values for printer', () => {
    expect(getPreset('printer')).toEqual({ dpi: 300, jpegQuality: 85 });
  });

  it('returns correct values for prepress', () => {
    expect(getPreset('prepress')).toEqual({ dpi: 300, jpegQuality: 95 });
  });

  it('returns correct values for default', () => {
    expect(getPreset('default')).toEqual({ dpi: 150, jpegQuality: 75 });
  });

  it('falls back to ebook when resolution is undefined', () => {
    expect(getPreset(undefined)).toEqual({ dpi: 150, jpegQuality: 65 });
  });
});

describe('applyOptions', () => {
  it('uses preset values when no overrides', () => {
    const result = applyOptions({ resolution: 'screen' });
    expect(result).toEqual({ dpi: 72, jpegQuality: 35 });
  });

  it('overrides dpi when imageDpi is set', () => {
    const result = applyOptions({ resolution: 'screen', imageDpi: 200 });
    expect(result).toEqual({ dpi: 200, jpegQuality: 35 });
  });

  it('overrides jpegQuality when jpegQuality is set', () => {
    const result = applyOptions({ resolution: 'ebook', jpegQuality: 90 });
    expect(result).toEqual({ dpi: 150, jpegQuality: 90 });
  });

  it('overrides both when both are set', () => {
    const result = applyOptions({ imageDpi: 100, jpegQuality: 50 });
    expect(result).toEqual({ dpi: 100, jpegQuality: 50 });
  });
});
