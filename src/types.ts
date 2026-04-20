export const VALID_RESOLUTIONS = [
  'screen',
  'ebook',
  'printer',
  'prepress',
  'default',
] as const;

export type Resolution = (typeof VALID_RESOLUTIONS)[number];

export type Options = {
  compatibilityLevel?: number;
  /**
   * Can be
   *
   * `screen` selects low-resolution output similar to the Acrobat Distiller (up to version X) "Screen Optimized" setting.
   *
   * `ebook` selects medium-resolution output similar to the Acrobat Distiller (up to version X) "eBook" setting.
   *
   * `printer` selects output similar to the Acrobat Distiller "Print Optimized" (up to version X) setting.
   *
   * `prepress` selects output similar to Acrobat Distiller "Prepress Optimized" (up to version X) setting.
   *
   * `default` selects output intended to be useful across a wide variety of uses, possibly at the expense of a larger output file.
   *
   * Default is `ebook`
   */
  resolution?: Resolution;
  /**
   * Set quality of pdf images (DPI).
   * Must be between 1 and 600.
   * Default is `100`
   */
  imageQuality?: number;
  /**
   * The path for ghostscript binary directory.
   *
   * `You can download binaries in releases section inside any version of this repository.`
   */
  gsModule?: string;
  /**
   * The pdf password
   */
  pdfPassword?: string;
  /**
   * Remove password of a protected pdf, after compression
   */
  removePasswordAfterCompression?: boolean;
};

/**
 * Result of a PDF compression operation.
 */
export type CompressResult = {
  /** The compressed PDF as a Buffer */
  buffer: Buffer;
  /** Original file size in bytes */
  originalSize: number;
  /** Compressed file size in bytes */
  compressedSize: number;
  /** Compression ratio (e.g., 0.65 means 35% smaller) */
  compressionRatio: number;
  /** Time taken in milliseconds */
  duration: number;
};

/**
 * Custom error class for compress-pdf errors.
 */
export class CompressPdfError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CompressPdfError';
  }
}
