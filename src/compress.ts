import path from 'path';
import util from 'util';
import fs from 'fs';
import os from 'os';
import childProcess from 'child_process';
import { randomUUID } from 'crypto';
import type { Readable } from 'node:stream';
import getBinPath from './get-bin-path';
import analyze, { pdfPageCount, presetForKind } from './analyze';
import { assertPagesWithin, expandPages, parsePages } from './pages';
import { assertMetadata, buildDocinfoProgram } from './metadata';
import {
  assertPdfa,
  buildPdfaDefinition,
  findDefaultRgbIcc,
  pdfaCompatibility,
  pdfaFlags,
} from './pdfa';
import { holdPdf, listSources } from './pdf-source';
import {
  VALID_RESOLUTIONS,
  CompressPdfError,
  type Options,
  type PdfaLevel,
  type PdfMetadata,
  type PdfSource,
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
  Omit<
    Options,
    | 'gsModule'
    | 'signal'
    | 'output'
    | 'targetSize'
    | 'resolution'
    | 'setMetadata'
    | 'pdfa'
    | 'pages'
  >
> & { resolution: Resolution } = {
  compatibilityLevel: 1.4,
  resolution: 'ebook',
  imageQuality: 100,
  pdfPassword: '',
  removePasswordAfterCompression: false,
  timeout: 120_000,
  returnOriginalIfLarger: false,
  stripMetadata: false,
  sanitize: false,
};

type ResolvedOptions = Required<
  Omit<
    Options,
    | 'gsModule'
    | 'signal'
    | 'output'
    | 'targetSize'
    | 'resolution'
    | 'setMetadata'
    | 'pdfa'
    | 'pages'
  >
> & {
  gsModule: string;
  resolution: Resolution;
  signal?: AbortSignal;
  output?: string;
  targetSize?: number;
  setMetadata?: PdfMetadata;
  pdfa?: PdfaLevel;
  pages?: string;
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

  assertMetadata(opts.setMetadata);
}

/**
 * Build the Ghostscript arguments array.
 * Using an array (for execFile) instead of a string (for exec)
 * prevents command injection vulnerabilities.
 */
function buildGsArgs(options: {
  output: string;
  inputFiles: string[];
  compatibilityLevel: number;
  resolution: string;
  imageQuality: number;
  pdfPassword: string;
  removePasswordAfterCompression: boolean;
  stripMetadata: boolean;
  sanitize: boolean;
  setMetadata?: PdfMetadata;
  pdfa?: PdfaLevel;
  pdfaDefinition?: string;
  pages?: string;
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

  if (options.pages !== undefined) {
    args.push(`-sPageList=${options.pages}`);
  }

  if (options.pdfa) {
    args.push(...pdfaFlags(options.pdfa));
  }

  if (options.pdfPassword) {
    args.push(`-sPDFPassword=${options.pdfPassword}`);
  }

  if (options.pdfPassword && !options.removePasswordAfterCompression) {
    args.push(
      `-sOwnerPassword=${options.pdfPassword}`,
      `-sUserPassword=${options.pdfPassword}`
    );
  }

  const docinfo = buildDocinfoProgram({
    stripMetadata: options.stripMetadata,
    sanitize: options.sanitize,
    setMetadata: options.setMetadata,
  });
  if (options.pdfaDefinition) {
    args.push(options.pdfaDefinition);
  }
  if (docinfo) {
    args.push('-f', ...options.inputFiles, '-c', docinfo);
  } else {
    args.push(...options.inputFiles);
  }

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

function isStrictlyIncreasing(pages: readonly number[]): boolean {
  return pages.every((page, index) => index === 0 || page > pages[index - 1]);
}

/** Copy a page as-is. The caller's compression runs once, on the joined file. */
const COPY_PAGE_ARGS = [
  '-dPassThroughJPEGImages=true',
  '-dPassThroughJPXImages=true',
  '-dDownsampleColorImages=false',
  '-dDownsampleGrayImages=false',
  '-dDownsampleMonoImages=false',
  '-dEncodeColorImages=false',
  '-dEncodeGrayImages=false',
  '-dEncodeMonoImages=false',
];

/**
 * Compress a PDF file using Ghostscript.
 * A list of files is joined in that order.
 *
 * @param file - Path, bytes, stream, or a list of those.
 * @param options - Compression options. When `output` is set, Ghostscript
 *          writes to that path and the PDF bytes are not returned.
 */
async function compress(
  file: PdfSource | readonly PdfSource[],
  options: Options & { output: string }
): Promise<CompressFileResult>;
async function compress(
  file: PdfSource | readonly PdfSource[],
  options?: Options
): Promise<Buffer & CompressResult>;
async function compress(
  file: PdfSource | readonly PdfSource[],
  options?: Options
): Promise<(Buffer & CompressResult) | CompressFileResult> {
  const startTime = Date.now();

  const userOptions = definedOptions(options);
  const inputs = listSources(file);
  const pageList =
    userOptions.pages !== undefined ? parsePages(userOptions.pages) : undefined;
  assertPdfa(userOptions.pdfa);
  if (userOptions.pdfa) {
    const requiredLevel = pdfaCompatibility(userOptions.pdfa);
    if (userOptions.compatibilityLevel === undefined) {
      userOptions.compatibilityLevel = requiredLevel;
    } else if (userOptions.compatibilityLevel !== requiredLevel) {
      throw new CompressPdfError(
        `compatibilityLevel must be ${requiredLevel} when pdfa is ${userOptions.pdfa}, got ${userOptions.compatibilityLevel}`
      );
    }
  }
  const { resolution: requestedResolution, ...optionsWithoutResolution } =
    userOptions;
  const resolvedGsModule = userOptions.gsModule ?? getBinPath(os.platform());
  let resolvedResolution: Resolution = defaultOptions.resolution;
  if (requestedResolution && requestedResolution !== 'auto') {
    resolvedResolution = requestedResolution;
  }

  if (inputs.length > 1) {
    if (pageList !== undefined) {
      throw new CompressPdfError(
        'pages cannot be used when compressing more than one PDF'
      );
    }
    if (requestedResolution === 'auto') {
      throw new CompressPdfError('resolution auto needs a single PDF');
    }
    if (userOptions.returnOriginalIfLarger) {
      throw new CompressPdfError(
        'returnOriginalIfLarger cannot be used when compressing more than one PDF'
      );
    }
  }

  const mergedOptions: ResolvedOptions = {
    ...defaultOptions,
    ...optionsWithoutResolution,
    gsModule: resolvedGsModule,
    resolution: resolvedResolution,
  };

  validateOptions(mergedOptions);

  const {
    imageQuality,
    compatibilityLevel,
    gsModule,
    pdfPassword,
    removePasswordAfterCompression,
    timeout,
    signal,
    returnOriginalIfLarger,
    targetSize,
    stripMetadata,
    sanitize,
    setMetadata,
    pdfa,
  } = mergedOptions;
  let { resolution } = mergedOptions;

  const userOutput =
    typeof userOptions.output === 'string' && userOptions.output.length > 0
      ? path.resolve(userOptions.output)
      : undefined;

  let pdfaDefinition: string | undefined;
  const attemptOutputs: string[] = [];
  const tempInputs: string[] = [];

  try {
    if (pdfa) {
      const iccPath = findDefaultRgbIcc(gsModule);
      pdfaDefinition = path.resolve(
        os.tmpdir(),
        `compress-pdf-pdfa-${randomUUID()}.ps`
      );
      await fs.promises.writeFile(pdfaDefinition, buildPdfaDefinition(iccPath));
    }

    // A fast failure must not return before a slower write records its file.
    const settled = await Promise.allSettled(
      inputs.map((input) => holdPdf(input))
    );
    const prepared: Awaited<ReturnType<typeof holdPdf>>[] = [];
    let failure: unknown;
    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.temp) tempInputs.push(result.value.filePath);
        prepared.push(result.value);
      } else if (failure === undefined) {
        failure = result.reason;
      }
    });
    if (failure !== undefined) {
      throw failure instanceof Error
        ? failure
        : new CompressPdfError('Ghostscript failed to compress the PDF.');
    }
    if (requestedResolution === 'auto') {
      const info = await analyze(prepared[0].filePath, {
        gsModule,
        pdfPassword,
        timeout,
        signal,
      });
      resolution = presetForKind(info.kind);
    }
    const attempts: AttemptSettings[] =
      targetSize !== undefined
        ? buildTargetSizeAttempts({
            resolution,
            imageQuality,
          })
        : [{ resolution, imageQuality }];
    let inputFiles = prepared.map((item) => item.filePath);
    const originalFiles = inputFiles.slice();
    let gsPages = pageList;

    if (pageList !== undefined) {
      const count = await pdfPageCount(inputFiles[0], {
        gsModule,
        pdfPassword,
        timeout,
        signal,
      });
      assertPagesWithin(pageList, count);
      const numbers = expandPages(pageList);
      if (!isStrictlyIncreasing(numbers)) {
        const extracted: string[] = [];
        let pageIndex = 0;
        // Ghostscript only accepts a page list in increasing order.
        // Copy each page without recompressing images, then compress
        // those files once, in the written order.
        /* eslint-disable no-await-in-loop */
        while (pageIndex < numbers.length) {
          const page = numbers[pageIndex];
          pageIndex += 1;
          const filePath = path.resolve(
            os.tmpdir(),
            `compress-pdf-${randomUUID()}`
          );
          tempInputs.push(filePath);
          const args = [
            '-q',
            '-dNOPAUSE',
            '-dBATCH',
            '-dSAFER',
            '-sDEVICE=pdfwrite',
            ...COPY_PAGE_ARGS,
            `-sPageList=${page}`,
            `-sOutputFile=${filePath}`,
          ];
          if (pdfPassword) {
            args.push(`-sPDFPassword=${pdfPassword}`);
          }
          args.push(inputFiles[0]);
          await runGhostscript({
            gsModule,
            args,
            timeout,
            signal,
            pdfPassword,
          });
          extracted.push(filePath);
        }
        /* eslint-enable no-await-in-loop */
        inputFiles = extracted;
        gsPages = undefined;
      }
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
        inputFiles,
        compatibilityLevel,
        resolution: attempt.resolution,
        imageQuality: attempt.imageQuality,
        pdfPassword,
        removePasswordAfterCompression,
        stripMetadata,
        sanitize,
        setMetadata,
        pdfa,
        pdfaDefinition,
        pages: gsPages,
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

    const originalSize = prepared.reduce((total, item) => total + item.size, 0);
    const duration = Date.now() - startTime;
    const useOriginal =
      inputs.length === 1 &&
      returnOriginalIfLarger &&
      chosenSize >= originalSize;
    const originalFile = originalFiles[0];

    if (userOutput) {
      if (useOriginal) {
        await fs.promises.copyFile(originalFile, userOutput);
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

    const resultBuffer = await fs.promises.readFile(
      useOriginal ? originalFile : chosenPath
    );

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
    await Promise.all(tempInputs.map((filePath) => safeUnlink(filePath)));
    if (pdfaDefinition) await safeUnlink(pdfaDefinition);
    await Promise.all(attemptOutputs.map((filePath) => safeUnlink(filePath)));
  }
}

/**
 * Compress a PDF and return a stream of the finished file.
 * The stream starts only after Ghostscript finishes. `output` is rejected.
 * Closing the stream deletes the temporary file.
 */
export async function compressStream(
  file: PdfSource | readonly PdfSource[],
  options?: Options
): Promise<Readable & CompressResult> {
  if (typeof options?.output === 'string') {
    throw new CompressPdfError('output cannot be used with compressStream');
  }

  const tempOut = path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
  try {
    const result = await compress(file, { ...options, output: tempOut });
    const stream = fs.createReadStream(tempOut);
    let removed = false;
    const remove = (): void => {
      if (removed) return;
      // Delete only after the read handle is released. If that delete
      // fails, try once more without treating the file as already gone.
      fs.promises.unlink(tempOut).then(
        () => {
          removed = true;
        },
        () => {
          setImmediate(() => {
            if (removed) return;
            fs.promises.unlink(tempOut).then(
              () => {
                removed = true;
              },
              () => undefined
            );
          });
        }
      );
    };
    stream.on('close', remove);
    Object.defineProperties(stream, {
      originalSize: { value: result.originalSize, enumerable: false },
      compressedSize: { value: result.compressedSize, enumerable: false },
      compressionRatio: { value: result.compressionRatio, enumerable: false },
      duration: { value: result.duration, enumerable: false },
    });
    return stream as unknown as Readable & CompressResult;
  } catch (error) {
    await safeUnlink(tempOut);
    throw error;
  }
}

export default compress;
