import fs from 'fs';
import { PDFDocument, PDFRawStream, PDFName, PDFNumber } from 'pdf-lib';
import { VALID_RESOLUTIONS, CompressPdfError, type Options, type CompressResult } from './types';
import { applyOptions } from './pdf/presets';
import { loadPdf, savePdf } from './pdf/parser';
import { optimizeJpegStream } from './pdf/image-optimizer';
import { optimizeFlateStream } from './pdf/stream-optimizer';

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

  Object.defineProperties(result, {
    buffer: { value: result, enumerable: false, writable: false, configurable: true },
    originalSize: { value: originalSize, enumerable: false, writable: false, configurable: true },
    compressedSize: { value: compressedSize, enumerable: false, writable: false, configurable: true },
    compressionRatio: { value: compressionRatio, enumerable: false, writable: false, configurable: true },
    duration: { value: duration, enumerable: false, writable: false, configurable: true },
  });

  return result;
}

export default compress;
