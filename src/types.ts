export const VALID_RESOLUTIONS = [
  'screen',
  'ebook',
  'printer',
  'prepress',
  'default',
] as const;

export type Resolution = (typeof VALID_RESOLUTIONS)[number];

/**
 * `auto` is not a Ghostscript preset. `compress` turns it into
 * `screen`, `ebook`, or `printer` after `analyze`.
 */
export type ResolutionSetting = Resolution | 'auto';

export type PdfKind = 'scanned' | 'vector' | 'mixed';

/**
 * What a PDF is made of. `estimatedGain` is a rough guess of how much
 * compression might save, from 0 to 1, not a measured result.
 */
export type PdfAnalysis = {
  pages: number;
  images: number;
  /** Highest image DPI found, or null when the PDF has no images. */
  maxImageDpi: number | null;
  fonts: number;
  kind: PdfKind;
  estimatedGain: number;
};

export type AnalyzeOptions = {
  gsModule?: string;
  pdfPassword?: string;
  timeout?: number;
  signal?: AbortSignal;
};

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
   * Default is `ebook`.
   *
   * `auto` looks at the PDF and picks `screen` (scanned), `ebook` (mixed),
   * or `printer` (vector). It is never sent to Ghostscript.
   */
  resolution?: ResolutionSetting;
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
  /**
   * How long to wait for Ghostscript, in milliseconds.
   * Default is 120000 (2 minutes).
   */
  timeout?: number;
  /**
   * Cancels the Ghostscript process when aborted.
   */
  signal?: AbortSignal;
  /**
   * When true, return the original PDF if Ghostscript output is larger
   * than or equal to the input. Default is `false`.
   */
  returnOriginalIfLarger?: boolean;
  /**
   * Write the compressed PDF to this path instead of returning the bytes.
   * Ghostscript writes directly to the file so the result is not loaded
   * into memory.
   */
  output?: string;
  /**
   * Maximum compressed size in bytes. When set, tries up to 6 preset/DPI
   * combinations and returns the first result that fits, or the smallest
   * attempt if none fit.
   */
  targetSize?: number;
};

/**
 * Result of a PDF compression operation.
 */
export type CompressResult = {
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
 * Result when `output` is set: metadata plus the absolute output path.
 */
export type CompressFileResult = CompressResult & {
  /** Absolute path written by compression */
  output: string;
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
