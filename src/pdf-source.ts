import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { buffer as readToBuffer } from 'node:stream/consumers';
import { CompressPdfError, type PdfSource } from './types';

/**
 * A PDF kept where Ghostscript can read it.
 * `temp` files belong to the caller and must be deleted.
 */
export type HeldPdf = {
  filePath: string;
  temp: boolean;
  size: number;
  bytes?: Buffer;
};

function isByteSource(
  value: unknown
): value is Buffer | Uint8Array | ArrayBuffer {
  return (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  );
}

function isNodeReadable(value: unknown): value is Readable {
  if (value === null || typeof value !== 'object') return false;
  if (isByteSource(value)) return false;
  const candidate = value as { read?: unknown; pipe?: unknown };
  return (
    typeof candidate.read === 'function' && typeof candidate.pipe === 'function'
  );
}

function isWebReadable(value: unknown): value is WebReadableStream<Uint8Array> {
  if (value === null || typeof value !== 'object') return false;
  if (isByteSource(value)) return false;
  return typeof (value as { getReader?: unknown }).getReader === 'function';
}

function isSingleSource(value: unknown): value is PdfSource {
  return (
    typeof value === 'string' ||
    isByteSource(value) ||
    isNodeReadable(value) ||
    isWebReadable(value)
  );
}

/** One PDF, or a list of PDFs in join order. An empty list is rejected. */
export function listSources(
  file: PdfSource | readonly PdfSource[]
): PdfSource[] {
  if (!Array.isArray(file)) {
    if (!isSingleSource(file)) {
      throw new CompressPdfError('compress needs at least one PDF');
    }
    return [file];
  }
  if (file.length === 0) {
    throw new CompressPdfError('compress needs at least one PDF');
  }
  return [...file];
}

async function bytesFrom(source: Exclude<PdfSource, string>): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) {
    if (source.byteLength === 0) {
      throw new CompressPdfError('the PDF is empty');
    }
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source instanceof ArrayBuffer) {
    if (source.byteLength === 0) {
      throw new CompressPdfError('the PDF is empty');
    }
    return Buffer.from(source);
  }

  const node = isWebReadable(source) ? Readable.fromWeb(source) : source;
  const bytes = Buffer.from(await readToBuffer(node));
  if (bytes.length === 0) {
    throw new CompressPdfError('the PDF is empty');
  }
  return bytes;
}

function resolveInputPath(source: string): string {
  const root = path.resolve(process.env.COMPRESS_PDF_INPUT_ROOT ?? process.cwd());
  const filePath = path.resolve(root, source);
  const relative = path.relative(root, filePath);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new CompressPdfError('input file path is outside the allowed root');
  }
  return filePath;
}

/**
 * Turn any accepted input into a file path.
 * Streams and byte views are written to a temporary file first.
 */
export async function holdPdf(source: PdfSource): Promise<HeldPdf> {
  if (typeof source === 'string') {
    const filePath = resolveInputPath(source);
    if (!fs.existsSync(filePath)) {
      throw new CompressPdfError(`File not found: ${source}`);
    }
    const { size } = await fs.promises.stat(filePath);
    return { filePath, temp: false, size };
  }

  const bytes = await bytesFrom(source);
  const filePath = path.resolve(os.tmpdir(), `compress-pdf-${randomUUID()}`);
  try {
    await fs.promises.writeFile(filePath, bytes);
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => undefined);
    throw error;
  }
  return { filePath, temp: true, size: bytes.length, bytes };
}
