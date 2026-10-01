import compress from '@/compress';
import type { Options } from './types';

const PDF_TYPE = 'application/pdf';
const TEXT_TYPE = 'text/plain; charset=utf-8';

export type HttpPdfResponse = {
  status: number;
  body: Buffer | string;
  contentType: string;
  headers: Record<string, string>;
};

function text(status: number, body: string): HttpPdfResponse {
  return {
    status,
    body,
    contentType: TEXT_TYPE,
    headers: {},
  };
}

export function linkSignals(
  requestSignal: AbortSignal,
  userSignal?: AbortSignal
): AbortSignal {
  if (!userSignal) {
    return requestSignal;
  }
  if (requestSignal.aborted || userSignal.aborted) {
    const aborted = new AbortController();
    aborted.abort();
    return aborted.signal;
  }
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  requestSignal.addEventListener('abort', abort);
  userSignal.addEventListener('abort', abort);
  return controller.signal;
}

function compressionOptions(
  options: Options | undefined
): Omit<Options, 'output' | 'signal'> {
  const rest: Options = { ...options };
  delete rest.output;
  delete rest.signal;
  return rest;
}

/**
 * Compress an uploaded PDF for an HTTP response.
 * `output` is refused: the response body is the PDF.
 */
export async function compressUpload(
  body: unknown,
  options: Options | undefined,
  signal: AbortSignal
): Promise<HttpPdfResponse> {
  if (options?.output !== undefined) {
    return text(400, 'output cannot be used when compressing an upload');
  }
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return text(400, 'the request body must be a PDF');
  }

  try {
    const result = await compress(body, {
      ...compressionOptions(options),
      signal: linkSignals(signal, options?.signal),
    });
    return {
      status: 200,
      body: result,
      contentType: PDF_TYPE,
      headers: {
        'X-Original-Size': String(result.originalSize),
        'X-Compressed-Size': String(result.compressedSize),
        'X-Compression-Ratio': String(result.compressionRatio),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Ghostscript failed to compress the PDF.';
    return text(500, message);
  }
}
