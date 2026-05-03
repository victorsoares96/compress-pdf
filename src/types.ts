export const VALID_RESOLUTIONS = [
  'screen',
  'ebook',
  'printer',
  'prepress',
  'default',
] as const;

export type Resolution = (typeof VALID_RESOLUTIONS)[number];

export type Options = {
  /**
   * Compression quality preset.
   *
   * `screen` — 72 DPI, JPEG quality 35. Smallest file, lowest quality.
   * `ebook` — 150 DPI, JPEG quality 65. Good balance. Default.
   * `printer` — 300 DPI, JPEG quality 85. High quality for printing.
   * `prepress` — 300 DPI, JPEG quality 95. Maximum quality.
   * `default` — 150 DPI, JPEG quality 75.
   *
   * `imageDpi` and `jpegQuality` override the preset values individually.
   */
  resolution?: Resolution;

  /**
   * Target DPI for image downsampling. Range 1–600.
   * Overrides the DPI value from the `resolution` preset.
   */
  imageDpi?: number;

  /**
   * JPEG encoder quality for image streams. Range 0–100.
   * Overrides the quality value from the `resolution` preset.
   */
  jpegQuality?: number;

  /**
   * Password for encrypted PDF files.
   */
  pdfPassword?: string;

  /**
   * Remove password protection after compression.
   * Requires `pdfPassword` to be set.
   */
  removePasswordAfterCompression?: boolean;
};

export type CompressResult = {
  buffer: Buffer;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  duration: number;
};

export class CompressPdfError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CompressPdfError';
  }
}
