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

/**
 * Document info written onto the compressed PDF.
 * Omitted fields are left as they are, unless metadata is being cleared.
 */
export type PdfMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
};

/**
 * PDF/A level Ghostscript can write. Only conformance `b` exists here.
 */
export type PdfaLevel = '1b' | '2b' | '3b';

export type Options = {
  /**
   * PDF compatibility level from 1.0 to 2.0. Default is `1.4`.
   * When `pdfa` is set and this is omitted, `1b` uses `1.4` and
   * `2b` / `3b` use `1.7`. A value that does not match `pdfa` is rejected.
   */
  compatibilityLevel?: number;
  /**
   * Write a PDF/A file in the same Ghostscript pass. Omitted by default.
   * `1b` is PDF 1.4. `2b` and `3b` are PDF 1.7. Color is converted to RGB.
   * Features that cannot be kept are dropped. Ghostscript's own producer,
   * dates, and PDF/A identification block stay.
   */
  pdfa?: PdfaLevel;
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
   * JPEG quality for color and gray photos, from 1 to 100.
   * `100` keeps the most detail. Omitted by default, so the preset
   * keeps Ghostscript's own factor. When set, those photos are stored
   * as JPEG. Black-and-white images stay on fax compression.
   */
  jpegQuality?: number;
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
  /**
   * Clear title, author, subject, keywords, and creator on the compressed PDF.
   * Default is `false`. Ghostscript still writes its own producer and dates.
   */
  stripMetadata?: boolean;
  /**
   * Replace document info on the compressed PDF.
   * With `stripMetadata` or `sanitize`, fields you omit are cleared.
   */
  setMetadata?: PdfMetadata;
  /**
   * Clear document info, including the extra metadata block Ghostscript
   * rebuilds from that info. Does not remove links, forms, or annotations.
   * Default is `false`.
   */
  sanitize?: boolean;
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
