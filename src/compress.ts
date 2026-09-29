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
  type CompressFileResult,
} from './types';

const execFile = util.promisify(childProcess.execFile);
const GS_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Strip undefined entries so `{ ...defaults, ...options }` does not overwrite
 * defaults (e.g. CLI passes `resolution: undefined` and would clear `ebook`).
 */
function definedOptions(options?: Options): Partial<Options> {
  if (!options) return {};
  return Object.fromEntries(
    Object.entries(options).filter((entry) => entry[1] !== undefined)
  ) as Partial<Options>;
}

const defaultOptions: Required<
  Omit<Options, 'gsModule' | 'signal' | 'output'>
> = {
  compatibilityLevel: 1.4,
  resolution: 'ebook',
  imageQuality: 100,
  pdfPassword: '',
  removePasswordAfterCompression: false,
  timeout: 120_000,
  returnOriginalIfLarger: false,
};

type ResolvedOptions = Required<
  Omit<Options, 'gsModule' | 'signal' | 'output'>
> & {
  gsModule: string;
  signal?: AbortSignal;
  output?: string;
};

/**
 * Validate compression options before executing.
 */
function validateOptions(opts: ResolvedOptions): void {
  if (
    !VALID_RESOLUTIONS.includes(
      opts.resolution as (typeof VALID_RESOLUTIONS)[number]
    )
  ) {
    throw new CompressPdfError(
      `Invalid resolution "${opts.resolution}". Must be one of: ${VALID_RESOLUTIONS.join(', ')}`
    );
  }

  if (
    !Number.isFinite(opts.imageQuality) ||
    opts.imageQuality < 1 ||
    opts.imageQuality > 600
  ) {
    throw new CompressPdfError(
      `imageQuality must be between 1 and 600, got ${opts.imageQuality}`
    );
  }

  if (
    !Number.isFinite(opts.compatibilityLevel) ||
    opts.compatibilityLevel < 1 ||
    opts.compatibilityLevel > 2
  ) {
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

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function errorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function isAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const aborted = error as { name?: string; code?: unknown };
  return aborted.name === 'AbortError' || aborted.code === 'ABORT_ERR';
}

function isExecTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const timedOut = error as {
    killed?: boolean;
    signal?: NodeJS.Signals | null;
  };
  return timedOut.killed === true && timedOut.signal === 'SIGTERM';
}

function redactCause(error: unknown, secret: string): unknown {
  if (!secret || !(error instanceof Error)) return error;

  const redacted = new Error(redactSecret(error.message, secret));
  redacted.name = error.name;
  if (error.stack) {
    redacted.stack = redactSecret(error.stack, secret);
  }
  return redacted;
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

async function writeOriginalTo(
  file: string | Buffer,
  destination: string
): Promise<void> {
  if (typeof file === 'string') {
    await fs.promises.copyFile(path.resolve(file), destination);
  } else {
    await fs.promises.writeFile(destination, file);
  }
}

/**
 * Compress a PDF file using Ghostscript.
 *
 * @param file - Path to the PDF file or a Buffer containing the PDF data.
 * @param options - Compression options. When `output` is set, Ghostscript
 *          writes to that path and the PDF bytes are not returned.
 */
async function compress(
  file: string | Buffer,
  options: Options & { output: string }
): Promise<CompressFileResult>;
async function compress(
  file: string | Buffer,
  options?: Options
): Promise<Buffer & CompressResult>;
async function compress(
  file: string | Buffer,
  options?: Options
): Promise<(Buffer & CompressResult) | CompressFileResult> {
  const startTime = Date.now();

  const userOptions = definedOptions(options);
  const mergedOptions: ResolvedOptions = {
    ...defaultOptions,
    ...userOptions,
    gsModule: userOptions.gsModule ?? getBinPath(os.platform()),
  };

  validateOptions(mergedOptions);

  const {
    resolution,
    imageQuality,
    compatibilityLevel,
    gsModule,
    pdfPassword,
    removePasswordAfterCompression,
    timeout,
    signal,
    returnOriginalIfLarger,
  } = mergedOptions;

  // Validate that source file exists (when path is provided)
  if (typeof file === 'string' && !fs.existsSync(file)) {
    throw new CompressPdfError(`File not found: ${file}`);
  }

  const userOutput =
    typeof userOptions.output === 'string' && userOptions.output.length > 0
      ? path.resolve(userOptions.output)
      : undefined;
  const gsOutput =
    userOutput ?? path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
  const ownsTempOutput = userOutput === undefined;
  let tempFile: string | undefined;

  try {
    let inputFile: string;

    if (typeof file === 'string') {
      inputFile = path.resolve(file);
    } else {
      tempFile = path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
      await fs.promises.writeFile(tempFile, file);
      inputFile = tempFile;
    }

    const args = buildGsArgs({
      output: gsOutput,
      inputFile,
      compatibilityLevel,
      resolution,
      imageQuality,
      pdfPassword,
      removePasswordAfterCompression,
    });

    try {
      await execFile(gsModule, args, {
        timeout,
        maxBuffer: GS_MAX_BUFFER,
        signal,
      });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        throw new CompressPdfError(
          `Ghostscript was not found at "${gsModule}". Set COMPRESS_PDF_BIN_PATH to the Ghostscript binary, or install Ghostscript manually.`,
          redactCause(error, pdfPassword)
        );
      }

      if (isAbort(error)) {
        throw new CompressPdfError(
          'Ghostscript compression was aborted.',
          redactCause(error, pdfPassword)
        );
      }

      if (isExecTimeout(error)) {
        throw new CompressPdfError(
          `Ghostscript timed out after ${timeout}ms.`,
          redactCause(error, pdfPassword)
        );
      }

      const stderr = redactSecret(
        outputText(
          error && typeof error === 'object' && 'stderr' in error
            ? error.stderr
            : undefined
        ).trim(),
        pdfPassword
      );
      const message = stderr
        ? `Ghostscript failed to compress the PDF. ${stderr}`
        : 'Ghostscript failed to compress the PDF.';
      throw new CompressPdfError(message, redactCause(error, pdfPassword));
    }

    const originalSize =
      typeof file === 'string'
        ? (await fs.promises.stat(file)).size
        : file.length;
    const ghostscriptSize = (await fs.promises.stat(gsOutput)).size;
    const duration = Date.now() - startTime;
    const useOriginal =
      returnOriginalIfLarger && ghostscriptSize >= originalSize;

    if (userOutput) {
      if (useOriginal) {
        await writeOriginalTo(file, userOutput);
      }

      const compressedSize = useOriginal ? originalSize : ghostscriptSize;
      const compressionRatio =
        originalSize > 0 ? compressedSize / originalSize : 0;

      return {
        originalSize,
        compressedSize,
        compressionRatio,
        duration,
        output: userOutput,
      };
    }

    let resultBuffer: Buffer;
    if (useOriginal) {
      resultBuffer =
        typeof file === 'string'
          ? await fs.promises.readFile(file)
          : Buffer.from(file);
    } else {
      resultBuffer = await fs.promises.readFile(gsOutput);
    }

    const compressedSize = useOriginal ? originalSize : resultBuffer.length;
    const compressionRatio =
      originalSize > 0 ? compressedSize / originalSize : 0;

    // Attach metadata as non-enumerable properties for backward compatibility.
    // The return value is still a Buffer (works with writeFile, etc.),
    // but you can access .originalSize, .compressedSize, .compressionRatio, .duration.
    // Leave Buffer#buffer as the native ArrayBuffer.
    Object.defineProperties(resultBuffer, {
      originalSize: { value: originalSize, enumerable: false },
      compressedSize: { value: compressedSize, enumerable: false },
      compressionRatio: { value: compressionRatio, enumerable: false },
      duration: { value: duration, enumerable: false },
    });

    return resultBuffer as Buffer & CompressResult;
  } finally {
    // Always clean up temporary files, even on error
    if (tempFile) await safeUnlink(tempFile);
    if (ownsTempOutput) await safeUnlink(gsOutput);
  }
}

export default compress;
