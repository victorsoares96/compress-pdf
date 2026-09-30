import { CompressPdfError } from './types';

export function assertJpegQuality(value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    throw new CompressPdfError(
      `jpegQuality must be an integer from 1 to 100, got ${String(value)}`
    );
  }
}

/** Ghostscript QFactor. Lower keeps more detail. */
export function jpegQFactor(quality: number): string {
  const factor = Math.max(0.15, (100 - quality) / 50);
  return factor.toFixed(2);
}

function imageDict(factor: string, color: boolean): string {
  const transform = color ? ' /ColorTransform 1' : '';
  return `<< /QFactor ${factor} /Blend 1${transform} /HSamples [1 1 1 1] /VSamples [1 1 1 1] >>`;
}

/**
 * Distiller params applied before the input file.
 * Samples stay [1 1 1 1] so the quality number is the only extra loss.
 */
export function buildJpegProgram(quality: number): string {
  const factor = jpegQFactor(quality);
  const color = imageDict(factor, true);
  const gray = imageDict(factor, false);
  return `<< /ColorImageDict ${color} /GrayImageDict ${gray} /ColorACSImageDict ${color} /GrayACSImageDict ${gray} >> setdistillerparams`;
}
