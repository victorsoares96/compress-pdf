import path from 'path';
import util from 'util';
import fs from 'fs';
import os from 'os';
import childProcess from 'child_process';
import { randomUUID } from 'crypto';
import getBinPath from './get-bin-path';
import {
  VALID_RESOLUTIONS,
  CompressPdfError,
  type Options,
  type CompressResult,
} from './types';

const execFile = util.promisify(childProcess.execFile);

const defaultOptions: Required<Options> = {
  compatibilityLevel: 1.4,
  resolution: 'ebook',
  imageQuality: 100,
  gsModule: getBinPath(os.platform()),
  pdfPassword: '',
  removePasswordAfterCompression: false,
};

/**
 * Validate compression options before executing.
 */
function validateOptions(opts: Required<Options>): void {
  if (
    !VALID_RESOLUTIONS.includes(
      opts.resolution as (typeof VALID_RESOLUTIONS)[number]
    )
  ) {
    throw new CompressPdfError(
      `Invalid resolution "${opts.resolution}". Must be one of: ${VALID_RESOLUTIONS.join(', ')}`
    );
  }

  if (opts.imageQuality < 1 || opts.imageQuality > 600) {
    throw new CompressPdfError(
      `imageQuality must be between 1 and 600, got ${opts.imageQuality}`
    );
  }

  if (opts.compatibilityLevel < 1 || opts.compatibilityLevel > 2) {
    throw new CompressPdfError(
      `compatibilityLevel must be between 1.0 and 2.0, got ${opts.compatibilityLevel}`
    );
  }
}

/**
 * Build the Ghostscript arguments array.
 * Using an array (for execFile) instead of a string (for exec)
 * prevents command injection vulnerabilities.
 */
function buildGsArgs(options: {
  output: string;
  inputFile: string;
  compatibilityLevel: number;
  resolution: string;
  imageQuality: number;
  pdfPassword: string;
  removePasswordAfterCompression: boolean;
}): string[] {
  const args: string[] = [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-dSimulateOverprint=true',
    '-sDEVICE=pdfwrite',
    `-dCompatibilityLevel=${options.compatibilityLevel}`,
    `-dPDFSETTINGS=/${options.resolution}`,
    '-dEmbedAllFonts=true',
    '-dSubsetFonts=true',
    '-dAutoRotatePages=/None',
    '-dColorImageDownsampleType=/Bicubic',
    `-dColorImageResolution=${options.imageQuality}`,
    '-dGrayImageDownsampleType=/Bicubic',
    `-dGrayImageResolution=${options.imageQuality}`,
    '-dMonoImageDownsampleType=/Bicubic',
    `-dMonoImageResolution=${options.imageQuality}`,
    `-sOutputFile=${options.output}`,
  ];

  if (options.pdfPassword) {
    args.push(`-sPDFPassword=${options.pdfPassword}`);
  }

  if (options.pdfPassword && !options.removePasswordAfterCompression) {
    args.push(
      `-sOwnerPassword=${options.pdfPassword}`,
      `-sUserPassword=${options.pdfPassword}`
    );
  }

  args.push(options.inputFile);

  return args;
}

/**
 * Safely remove a file, ignoring errors if it doesn't exist.
 */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore errors (file may not exist)
  }
}

/**
 * Compress a PDF file using Ghostscript.
 *
 * @param file - Path to the PDF file or a Buffer containing the PDF data.
 * @param options - Compression options.
 * @returns A CompressResult with the compressed buffer and metadata,
 *          or just the Buffer for backward compatibility when destructured.
 */
async function compress(file: string | Buffer, options?: Options) {
  const startTime = Date.now();

  const mergedOptions: Required<Options> = { ...defaultOptions, ...options };

  validateOptions(mergedOptions);

  const {
    resolution,
    imageQuality,
    compatibilityLevel,
    gsModule,
    pdfPassword,
    removePasswordAfterCompression,
  } = mergedOptions;

  // Validate that source file exists (when path is provided)
  if (typeof file === 'string' && !fs.existsSync(file)) {
    throw new CompressPdfError(`File not found: ${file}`);
  }

  const output = path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
  let tempFile: string | undefined;

  try {
    let inputFile: string;

    if (typeof file === 'string') {
      inputFile = file;
    } else {
      tempFile = path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
      await fs.promises.writeFile(tempFile, file);
      inputFile = tempFile;
    }

    const args = buildGsArgs({
      output,
      inputFile,
      compatibilityLevel,
      resolution,
      imageQuality,
      pdfPassword,
      removePasswordAfterCompression,
    });

    try {
      await execFile(gsModule, args);
    } catch (error) {
      throw new CompressPdfError(
        `Ghostscript failed to compress the PDF. ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }

    const compressedBuffer = await fs.promises.readFile(output);

    const originalSize =
      typeof file === 'string'
        ? (await fs.promises.stat(file)).size
        : file.length;

    const duration = Date.now() - startTime;
    const compressedSize = compressedBuffer.length;
    const compressionRatio =
      originalSize > 0 ? compressedSize / originalSize : 0;

    // Attach metadata as non-enumerable properties for backward compatibility.
    // The return value is still a Buffer (works with writeFile, etc.),
    // but you can access .originalSize, .compressedSize, .compressionRatio, .duration.
    Object.defineProperties(compressedBuffer, {
      buffer: { value: compressedBuffer, enumerable: false },
      originalSize: { value: originalSize, enumerable: false },
      compressedSize: { value: compressedSize, enumerable: false },
      compressionRatio: { value: compressionRatio, enumerable: false },
      duration: { value: duration, enumerable: false },
    });

    return compressedBuffer as Buffer & CompressResult;
  } finally {
    // Always clean up temporary files, even on error
    if (tempFile) await safeUnlink(tempFile);
    await safeUnlink(output);
  }
}

export default compress;
