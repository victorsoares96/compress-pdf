import util from 'util';
import fs from 'fs';
import os from 'os';
import childProcess from 'child_process';
import getBinPath from './get-bin-path';
import { holdPdf } from './pdf-source';
import { inspectPdfImages } from './pdf-images';
import {
  CompressPdfError,
  type AnalyzeOptions,
  type PdfAnalysis,
  type PdfKind,
  type PdfSource,
  type Resolution,
} from './types';

const execFile = util.promisify(childProcess.execFile);
const GS_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT = 120_000;

/**
 * Scanned means the file is mostly images: no fonts, or fewer than
 * one font for every ten images. A font on a scan still counts as scanned.
 */
export function classifyPdf(images: number, fonts: number): PdfKind {
  if (images >= 1 && (fonts === 0 || fonts * 10 <= images)) {
    return 'scanned';
  }
  if (images === 0 && fonts >= 1) {
    return 'vector';
  }
  return 'mixed';
}

export function presetForKind(kind: PdfKind): Resolution {
  if (kind === 'scanned') return 'screen';
  if (kind === 'vector') return 'printer';
  return 'ebook';
}

function estimatedGain(kind: PdfKind): number {
  if (kind === 'scanned') return 0.6;
  if (kind === 'vector') return 0.1;
  return 0.3;
}

function buildAnalysis(input: {
  pages: number;
  images: number;
  fonts: number;
  maxImageDpi: number | null;
}): PdfAnalysis {
  const kind = classifyPdf(input.images, input.fonts);
  return {
    pages: input.pages,
    images: input.images,
    maxImageDpi: input.images === 0 ? null : input.maxImageDpi,
    fonts: input.fonts,
    kind,
    estimatedGain: estimatedGain(kind),
  };
}

function parseStructured(text: string): PdfAnalysis | null {
  const pages = /^pages=(\d+)\s*$/m.exec(text);
  const images = /^images=(\d+)\s*$/m.exec(text);
  const fonts = /^fonts=(\d+)\s*$/m.exec(text);
  const dpi = /^maxImageDpi=(null|\d+(?:\.\d+)?)\s*$/m.exec(text);
  if (!pages || !images || !fonts || !dpi) return null;
  return buildAnalysis({
    pages: Number(pages[1]),
    images: Number(images[1]),
    fonts: Number(fonts[1]),
    maxImageDpi: dpi[1] === 'null' ? null : Number(dpi[1]),
  });
}

function parsePdfInfo(text: string): { pages: number; fonts: number } | null {
  const pages = /File has (\d+) page/.exec(text);
  if (!pages) return null;
  const fonts = new Set<string>();
  const lines = text.split('\n');
  let index = 0;
  while (index < lines.length) {
    const named = /^\s+(\S+)\s+(?:Type\d|CIDFont|MMType)\b/.exec(lines[index]);
    if (named) {
      fonts.add(named[1]);
    }
    index += 1;
  }
  return { pages: Number(pages[1]), fonts: fonts.size };
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

async function runPdfInfo(options: {
  gsModule: string;
  inputFile: string;
  pdfPassword: string;
  timeout: number;
  signal?: AbortSignal;
}): Promise<string> {
  const args = ['-q', '-dNODISPLAY', '-dPDFINFO'];
  if (options.pdfPassword) {
    args.push(`-sPDFPassword=${options.pdfPassword}`);
  }
  args.push(options.inputFile, '-c', 'quit');

  try {
    const result = await execFile(options.gsModule, args, {
      timeout: options.timeout,
      maxBuffer: GS_MAX_BUFFER,
      signal: options.signal,
    });
    return `${outputText(result.stdout)}\n${outputText(result.stderr)}`;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new CompressPdfError(
        `Ghostscript was not found at "${options.gsModule}". Set COMPRESS_PDF_BIN_PATH to the Ghostscript binary, or install Ghostscript manually.`
      );
    }
    if (isAbort(error)) {
      throw new CompressPdfError('Ghostscript inspection was aborted.');
    }
    if (isExecTimeout(error)) {
      throw new CompressPdfError(
        `Ghostscript timed out after ${options.timeout}ms.`
      );
    }

    const stderr = redactSecret(
      outputText(
        error && typeof error === 'object' && 'stderr' in error
          ? error.stderr
          : undefined
      ),
      options.pdfPassword
    );
    const stdout = redactSecret(
      outputText(
        error && typeof error === 'object' && 'stdout' in error
          ? error.stdout
          : undefined
      ),
      options.pdfPassword
    );
    const combined = `${stdout}\n${stderr}`.trim();
    const structured = parseStructured(combined);
    if (structured) return combined;
    const info = parsePdfInfo(combined);
    if (info) return combined;

    const message = combined
      ? `Ghostscript failed to inspect the PDF. ${redactSecret(combined, options.pdfPassword)}`
      : 'Ghostscript failed to inspect the PDF.';
    throw new CompressPdfError(message);
  }
}

/**
 * Inspect a PDF with Ghostscript: pages, images, highest image DPI,
 * fonts, and a kind (`scanned`, `vector`, or `mixed`).
 */
async function analyze(
  file: PdfSource,
  options?: AnalyzeOptions
): Promise<PdfAnalysis> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const pdfPassword = options?.pdfPassword ?? '';
  const gsModule = options?.gsModule ?? getBinPath(os.platform());
  const held = await holdPdf(file);

  try {
    const report = await runPdfInfo({
      gsModule,
      inputFile: held.filePath,
      pdfPassword,
      timeout,
      signal: options?.signal,
    });
    const structured = parseStructured(report);
    if (structured) return structured;

    const info = parsePdfInfo(report);
    if (!info) {
      throw new CompressPdfError('Ghostscript failed to inspect the PDF.');
    }

    const bytes = held.bytes ?? (await fs.promises.readFile(held.filePath));
    const images = inspectPdfImages(bytes);
    return buildAnalysis({
      pages: info.pages,
      fonts: info.fonts,
      images: images.images,
      maxImageDpi: images.maxImageDpi,
    });
  } finally {
    if (held.temp) {
      await fs.promises.unlink(held.filePath).catch(() => undefined);
    }
  }
}

/**
 * How many pages the PDF has. Uses the same Ghostscript report as `analyze`,
 * without counting images.
 */
export async function pdfPageCount(
  file: PdfSource,
  options?: AnalyzeOptions
): Promise<number> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const pdfPassword = options?.pdfPassword ?? '';
  const gsModule = options?.gsModule ?? getBinPath(os.platform());
  const held = await holdPdf(file);

  try {
    const report = await runPdfInfo({
      gsModule,
      inputFile: held.filePath,
      pdfPassword,
      timeout,
      signal: options?.signal,
    });
    const structured = parseStructured(report);
    if (structured) return structured.pages;
    const info = parsePdfInfo(report);
    if (!info) {
      throw new CompressPdfError('Ghostscript failed to inspect the PDF.');
    }
    return info.pages;
  } finally {
    if (held.temp) {
      await fs.promises.unlink(held.filePath).catch(() => undefined);
    }
  }
}

export default analyze;
