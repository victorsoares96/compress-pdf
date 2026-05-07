import fs from 'fs';
import { PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFDict, PDFBool } from 'pdf-lib';
import { VALID_RESOLUTIONS, CompressPdfError, type Options, type CompressResult } from './types';
import { applyOptions, CCITT_MIN_DPI } from './pdf/presets';
import { loadPdf, savePdf } from './pdf/parser';
import { optimizeJpegStream } from './pdf/image-optimizer';
import { optimizeFlateStream } from './pdf/stream-optimizer';
import { optimizeCCITTStream } from './pdf/ccitt-optimizer';
import type { CCITTParams } from './pdf/ccitt-decoder';

/**
 * Maximum total time (ms) allocated for CCITT stream decode/compress per `compress()` call.
 * Large PDFs can contain hundreds of high-resolution CCITT streams; without a budget,
 * processing time is unbounded. Streams are skipped (left as-is) once exhausted.
 * Motivated by A17_FlightPlan.pdf which has 618 CCITT streams at 2432×3229 px each.
 */
const CCITT_BUDGET_MS = 20_000;

function extractCCITTParams(decodeParms: unknown, fallbackRows = 0): CCITTParams {
  const defaults: CCITTParams = {
    K: 0,
    columns: 1728,
    rows: 0,
    blackIs1: false,
    encodedByteAlign: false,
  };

  if (!(decodeParms instanceof PDFDict)) return { ...defaults, rows: fallbackRows };

  const K = decodeParms.get(PDFName.of('K'));
  const columns = decodeParms.get(PDFName.of('Columns'));
  const rows = decodeParms.get(PDFName.of('Rows'));
  const blackIs1 = decodeParms.get(PDFName.of('BlackIs1'));
  const encodedByteAlign = decodeParms.get(PDFName.of('EncodedByteAlign'));

  return {
    K: K instanceof PDFNumber ? K.asNumber() : defaults.K,
    columns: columns instanceof PDFNumber ? columns.asNumber() : defaults.columns,
    rows: rows instanceof PDFNumber ? rows.asNumber() : fallbackRows,
    blackIs1: blackIs1 instanceof PDFBool ? blackIs1.asBoolean() : defaults.blackIs1,
    encodedByteAlign:
      encodedByteAlign instanceof PDFBool
        ? encodedByteAlign.asBoolean()
        : defaults.encodedByteAlign,
  };
}

/**
 * Validate compression options.
 * @throws {CompressPdfError} if any option value is out of range.
 */
function validateOptions(options?: Options): void {
  if (options?.resolution !== undefined && !VALID_RESOLUTIONS.includes(options.resolution)) {
    throw new CompressPdfError(
      `Invalid resolution "${options.resolution}". Must be one of: ${VALID_RESOLUTIONS.join(', ')}`
    );
  }

  if (options?.imageDpi !== undefined) {
    if (options.imageDpi < 1 || options.imageDpi > 600) {
      throw new CompressPdfError(
        `imageDpi must be between 1 and 600, got ${options.imageDpi}`
      );
    }
  }

  if (options?.jpegQuality !== undefined) {
    if (options.jpegQuality < 0 || options.jpegQuality > 100) {
      throw new CompressPdfError(
        `jpegQuality must be between 0 and 100, got ${options.jpegQuality}`
      );
    }
  }
}

/**
 * Compress a PDF file using a pure WASM/JS pipeline (no Ghostscript).
 *
 * @param input - Path to the PDF file or a Buffer containing the PDF data.
 * @param options - Compression options.
 * @returns A Buffer with CompressResult metadata attached.
 */
async function compress(
  input: string | Buffer,
  options?: Options
): Promise<Buffer & CompressResult> {
  const startTime = Date.now();

  // 1. Validate options first (before any I/O)
  validateOptions(options);

  // 2. Input handling
  let inputBuffer: Buffer;
  if (typeof input === 'string') {
    inputBuffer = await fs.promises.readFile(input);
  } else {
    inputBuffer = input;
  }

  // 3. Load PDF
  const doc = await loadPdf(inputBuffer, options?.pdfPassword);

  // 4. Get preset
  const preset = applyOptions(options ?? {});

  // 5. Optimize streams (skip for encrypted PDFs — stream bytes are still
  //    encrypted after ignoreEncryption:true load, so optimizers return null
  //    anyway; iterating also causes pdf-lib to log "Invalid object ref" noise
  //    and can corrupt the saved cross-reference table).
  const ccittStart = Date.now();
  let ccittBudgetWarned = false;
  for (const [, obj] of doc.isEncrypted ? [] : doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const filter = dict.get(PDFName.of('Filter'));
    const subtype = dict.get(PDFName.of('Subtype'));

    if (!(filter instanceof PDFName)) continue;

    const filterName = filter.asString();
    const streamBytes = obj.contents;

    if (filterName === 'DCTDecode') {
      // Only optimize image XObjects
      const isImage = subtype instanceof PDFName && subtype.asString() === 'Image';
      if (!isImage) continue;

      const widthObj = dict.get(PDFName.of('Width'));
      const heightObj = dict.get(PDFName.of('Height'));
      const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
      const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;

      const optimized = await optimizeJpegStream(streamBytes, {
        targetDpi: preset.dpi,
        jpegQuality: preset.jpegQuality,
        currentWidthPx: width,
        currentHeightPx: height,
        pageWidthPt: 612, // US Letter fallback
      });

      if (optimized !== null) {
        (obj as unknown as { contents: Uint8Array }).contents = optimized;
        dict.set(PDFName.of('Length'), PDFNumber.of(optimized.length));
      }
    } else if (filterName === 'FlateDecode') {
      const optimized = optimizeFlateStream(streamBytes);

      if (optimized !== null) {
        (obj as unknown as { contents: Uint8Array }).contents = optimized;
        dict.set(PDFName.of('Length'), PDFNumber.of(optimized.length));
      }
    } else if (filterName === '/CCITTFaxDecode') {
      const isImage = subtype instanceof PDFName && subtype.asString() === '/Image';
      if (!isImage) continue;

      const widthObj = dict.get(PDFName.of('Width'));
      const heightObj = dict.get(PDFName.of('Height'));
      const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
      const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;
      if (width === 0 || height === 0) continue;

      // Fast DPI pre-check: skip decode if no downscaling benefit
      const PAGE_WIDTH_PT = 612; // TODO: derive from actual page dimensions; 612pt = US Letter fallback
      const pageWidthInches = PAGE_WIDTH_PT / 72;
      const currentDpi = width / pageWidthInches;
      const effectiveDpi = Math.max(preset.dpi, CCITT_MIN_DPI);
      if (currentDpi <= effectiveDpi) continue;

      // Skip if time budget for CCITT processing is exhausted
      if (Date.now() - ccittStart > CCITT_BUDGET_MS) {
        if (!ccittBudgetWarned) {
          // eslint-disable-next-line no-console
          console.warn('[compress-pdf] CCITT time budget exhausted; remaining streams skipped');
          ccittBudgetWarned = true;
        }
        continue;
      }

      const params = extractCCITTParams(dict.get(PDFName.of('DecodeParms')), height);

      // BlackIs1=true CCITT streams have inverted polarity relative to DeviceGray convention.
      // Decoding and re-encoding as FlateDecode would invert colors without a /Decode [1 0] fix.
      // Skip optimization for these streams — they remain as CCITT, rendered correctly by the viewer.
      if (params.blackIs1) continue;

      const ccittResult = optimizeCCITTStream(streamBytes, params, {
        targetDpi: preset.dpi,
        currentWidthPx: width,
        pageWidthPt: PAGE_WIDTH_PT,
      });

      if (ccittResult !== null) {
        (obj as unknown as { contents: Uint8Array }).contents = ccittResult.data;
        dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        dict.delete(PDFName.of('DecodeParms'));
        dict.set(PDFName.of('Width'), PDFNumber.of(ccittResult.width));
        dict.set(PDFName.of('Height'), PDFNumber.of(ccittResult.height));
        dict.set(PDFName.of('Length'), PDFNumber.of(ccittResult.data.length));
      }
    }
  }

  // 6. Save
  const saved = await savePdf(doc, {
    removePassword: options?.removePasswordAfterCompression,
  });

  // 7. Build result
  const result = Buffer.from(saved) as Buffer & CompressResult;
  const originalSize = inputBuffer.length;
  const compressedSize = result.length;
  const compressionRatio = compressedSize / originalSize;
  const duration = Date.now() - startTime;

  // Note: do NOT override `result.buffer` — Buffer's native .buffer returns the underlying
  // ArrayBuffer and overriding it to `result` (a Uint8Array subclass) breaks pdf-lib's
  // ESM bundle which reads .buffer to construct a Uint8Array view of the compressed data.
  Object.defineProperties(result, {
    originalSize: { value: originalSize, enumerable: false, writable: false, configurable: true },
    compressedSize: { value: compressedSize, enumerable: false, writable: false, configurable: true },
    compressionRatio: { value: compressionRatio, enumerable: false, writable: false, configurable: true },
    duration: { value: duration, enumerable: false, writable: false, configurable: true },
  });

  return result;
}

export default compress;
