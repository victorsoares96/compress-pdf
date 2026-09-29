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
  type Resolution,
  type CompressResult,
  type CompressFileResult,
} from './types';

const execFile = util.promisify(childProcess.execFile);
const GS_MAX_BUFFER = 16 * 1024 * 1024;
const TARGET_SIZE_MAX_ATTEMPTS = 6;

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
  Omit<Options, 'gsModule' | 'signal' | 'output' | 'targetSize'>
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
  Omit<Options, 'gsModule' | 'signal' | 'output' | 'targetSize'>
> & {
  gsModule: string;
  signal?: AbortSignal;
  output?: string;
  targetSize?: number;
};

type AttemptSettings = {
  resolution: Resolution;
  imageQuality: number;
};

/**
 * Build the ladder of settings to try for targetSize.
 * Starts from the caller's settings, then steps toward smaller output.
 */
function buildTargetSizeAttempts(start: AttemptSettings): AttemptSettings[] {
  const candidates: AttemptSettings[] = [
    start,
    { resolution: start.resolution, imageQuality: 72 },
    { resolution: start.resolution, imageQuality: 50 },
    { resolution: 'ebook', imageQuality: 72 },
    { resolution: 'screen', imageQuality: 72 },
    { resolution: 'screen', imageQuality: 50 },
  ];

  return candidates
    .filter((candidate, index) => {
      const key = `${candidate.resolution}:${candidate.imageQuality}`;
      return (
        candidates.findIndex(
          (other) => `${other.resolution}:${other.imageQuality}` === key
        ) === index
      );
    })
    .slice(0, TARGET_SIZE_MAX_ATTEMPTS);
}

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

  if (opts.targetSize !== undefined) {
    if (!Number.isFinite(opts.targetSize) || opts.targetSize <= 0) {
      throw new CompressPdfError(
        `targetSize must be a positive number of bytes, got ${opts.targetSize}`
      );
    }
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

async function runGhostscript(options: {
  gsModule: string;
  args: string[];
  timeout: number;
  signal?: AbortSignal;
  pdfPassword: string;
}): Promise<void> {
  try {
    await execFile(options.gsModule, options.args, {
      timeout: options.timeout,
      maxBuffer: GS_MAX_BUFFER,
      signal: options.signal,
    });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new CompressPdfError(
        `Ghostscript was not found at "${options.gsModule}". Set COMPRESS_PDF_BIN_PATH to the Ghostscript binary, or install Ghostscript manually.`,
        redactCause(error, options.pdfPassword)
      );
    }

    if (isAbort(error)) {
      throw new CompressPdfError(
        'Ghostscript compression was aborted.',
        redactCause(error, options.pdfPassword)
      );
    }

    if (isExecTimeout(error)) {
      throw new CompressPdfError(
        `Ghostscript timed out after ${options.timeout}ms.`,
        redactCause(error, options.pdfPassword)
      );
    }

    const stderr = redactSecret(
      outputText(
        error && typeof error === 'object' && 'stderr' in error
          ? error.stderr
          : undefined
      ).trim(),
      options.pdfPassword
    );
    const message = stderr
      ? `Ghostscript failed to compress the PDF. ${stderr}`
      : 'Ghostscript failed to compress the PDF.';
    throw new CompressPdfError(
      message,
      redactCause(error, options.pdfPassword)
    );
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
    targetSize,
  } = mergedOptions;

  // Validate that source file exists (when path is provided)
  if (typeof file === 'string' && !fs.existsSync(file)) {
    throw new CompressPdfError(`File not found: ${file}`);
  }

  const userOutput =
    typeof userOptions.output === 'string' && userOptions.output.length > 0
      ? path.resolve(userOptions.output)
      : undefined;

  const attempts: AttemptSettings[] =
    targetSize !== undefined
      ? buildTargetSizeAttempts({
          resolution: resolution as Resolution,
          imageQuality,
        })
      : [{ resolution: resolution as Resolution, imageQuality }];

  let tempInput: string | undefined;
  const attemptOutputs: string[] = [];

  try {
    let inputFile: string;

    if (typeof file === 'string') {
      inputFile = path.resolve(file);
    } else {
      tempInput = path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
      await fs.promises.writeFile(tempInput, file);
      inputFile = tempInput;
    }

    let bestFittingPath: string | undefined;
    let bestFittingSize = Infinity;
    let smallestPath: string | undefined;
    let smallestSize = Infinity;
    let attemptIndex = 0;
    const searching = targetSize !== undefined;

    const discardAttempt = async (filePath: string): Promise<void> => {
      const index = attemptOutputs.indexOf(filePath);
      if (index >= 0) {
        attemptOutputs.splice(index, 1);
      }
      await safeUnlink(filePath);
    };

    // Attempts must run one after another: later settings depend on earlier sizes.
    /* eslint-disable no-await-in-loop */
    while (attemptIndex < attempts.length) {
      const attempt = attempts[attemptIndex];
      attemptIndex += 1;

      // A single call with `output` goes straight to that path. A search uses
      // temp files so a losing attempt never touches the destination.
      const attemptOut =
        !searching && userOutput
          ? userOutput
          : path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
      const isTempAttempt = attemptOut !== userOutput;
      if (isTempAttempt) {
        attemptOutputs.push(attemptOut);
      }

      const args = buildGsArgs({
        output: attemptOut,
        inputFile,
        compatibilityLevel,
        resolution: attempt.resolution,
        imageQuality: attempt.imageQuality,
        pdfPassword,
        removePasswordAfterCompression,
      });

      let size: number;
      try {
        await runGhostscript({
          gsModule,
          args,
          timeout,
          signal,
          pdfPassword,
        });
        const stat = await fs.promises.stat(attemptOut);
        size = stat.size;
      } catch (error) {
        if (isTempAttempt) {
          await discardAttempt(attemptOut);
        }
        if (smallestPath) {
          break;
        }
        throw error;
      }

      if (size < smallestSize) {
        if (
          smallestPath &&
          smallestPath !== attemptOut &&
          smallestPath !== userOutput
        ) {
          await discardAttempt(smallestPath);
        }
        smallestSize = size;
        smallestPath = attemptOut;
      } else if (isTempAttempt && attemptOut !== smallestPath) {
        await discardAttempt(attemptOut);
      }

      if (searching) {
        if (size <= targetSize && smallestSize <= targetSize) {
          bestFittingPath = smallestPath;
          bestFittingSize = smallestSize;
          break;
        }
      } else {
        bestFittingPath = attemptOut;
        bestFittingSize = size;
        break;
      }
    }
    /* eslint-enable no-await-in-loop */

    const chosenPath = bestFittingPath ?? smallestPath;
    const chosenSize = bestFittingPath ? bestFittingSize : smallestSize;

    if (!chosenPath) {
      throw new CompressPdfError('Ghostscript failed to compress the PDF.');
    }

    const originalSize =
      typeof file === 'string'
        ? (await fs.promises.stat(file)).size
        : file.length;
    const duration = Date.now() - startTime;
    const useOriginal = returnOriginalIfLarger && chosenSize >= originalSize;

    if (userOutput) {
      if (useOriginal) {
        await writeOriginalTo(file, userOutput);
      } else if (chosenPath !== userOutput) {
        await fs.promises.copyFile(chosenPath, userOutput);
      }

      const compressedSize = useOriginal ? originalSize : chosenSize;
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
      resultBuffer = await fs.promises.readFile(chosenPath);
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
    if (tempInput) await safeUnlink(tempInput);
    await Promise.all(attemptOutputs.map((filePath) => safeUnlink(filePath)));
  }
}

export default compress;
