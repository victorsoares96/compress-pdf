import type { Options, Resolution } from '../types';

type Preset = { dpi: number; jpegQuality: number };

const PRESETS: Record<Resolution, Preset> = {
  screen: { dpi: 72, jpegQuality: 35 },
  ebook: { dpi: 150, jpegQuality: 65 },
  printer: { dpi: 300, jpegQuality: 85 },
  prepress: { dpi: 300, jpegQuality: 95 },
  default: { dpi: 150, jpegQuality: 75 },
};

export const CCITT_MIN_DPI = 150;

export function getPreset(resolution: Resolution | undefined): Preset {
  return PRESETS[resolution ?? 'ebook'];
}

export function applyOptions(
  options: Pick<Options, 'resolution' | 'imageDpi' | 'jpegQuality'>
): Preset {
  const preset = getPreset(options.resolution);
  return {
    dpi: options.imageDpi ?? preset.dpi,
    jpegQuality: options.jpegQuality ?? preset.jpegQuality,
  };
}
