import compress from '@/compress';
import type { Options, UploadOptions } from './types';

const PDF_TYPE = 'application/pdf';
const TEXT_TYPE = 'text/plain; charset=utf-8';
const FAILURE = 'Ghostscript failed to compress the PDF.';

export type HttpPdfResponse = {
  status: number;
  body: Buffer | string;
  contentType: string;
  headers: Record<string, string>;
};

export type CloseSource = {
  on(event: 'close', listener: () => void): void;
  off?(event: 'close', listener: () => void): void;
  writableFinished?: boolean;
  destroyed?: boolean;
};

export type TrackedClose = {
  signal: AbortSignal;
  settle(): void;
  closed(): boolean;
};

function text(status: number, body: string): HttpPdfResponse {
  return {
    status,
    body,
    contentType: TEXT_TYPE,
    headers: {},
  };
}

export function positiveLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1;
}

/**
 * Reject options that cannot be applied to an upload response.
 * Returns undefined when compression may continue.
 */
export function rejectUploadOptions(
  options: UploadOptions | undefined
): HttpPdfResponse | undefined {
  if (options?.bodyLimit !== undefined && !positiveLimit(options.bodyLimit)) {
    return text(400, 'bodyLimit must be a positive number');
  }
  if (options?.output !== undefined) {
    return text(400, 'output cannot be used when compressing an upload');
  }
  return undefined;
}

export function bodyTooLarge(): HttpPdfResponse {
  return text(413, 'the request body is larger than the limit');
}

/**
 * Abort when the HTTP response closes before the handler finishes.
 * The request body is already consumed by then, so the request's own
 * `close` event does not mean the client went away.
 */
export function trackClose(source: CloseSource): TrackedClose {
  const controller = new AbortController();
  let settled = false;
  let closed = source.writableFinished === true || source.destroyed === true;
  const onClose = (): void => {
    if (settled) return;
    closed = true;
    controller.abort();
  };
  if (closed) {
    controller.abort();
  } else {
    source.on('close', onClose);
  }
  return {
    signal: controller.signal,
    settle(): void {
      settled = true;
      source.off?.('close', onClose);
    },
    closed(): boolean {
      return closed;
    },
  };
}

/**
 * Follow whichever signal aborts first.
 * `detach` drops the listeners so a long-lived caller signal
 * does not keep one controller per request.
 */
export function linkSignals(
  requestSignal: AbortSignal,
  userSignal?: AbortSignal
): { signal: AbortSignal; detach(): void } {
  if (!userSignal || requestSignal === userSignal) {
    return {
      signal: requestSignal,
      detach() {},
    };
  }
  if (requestSignal.aborted || userSignal.aborted) {
    const aborted = new AbortController();
    aborted.abort();
    return {
      signal: aborted.signal,
      detach() {},
    };
  }
  const controller = new AbortController();
  let detach = (): void => {};
  const onAbort = (): void => {
    detach();
    controller.abort();
  };
  detach = (): void => {
    requestSignal.removeEventListener('abort', onAbort);
    userSignal.removeEventListener('abort', onAbort);
  };
  requestSignal.addEventListener('abort', onAbort);
  userSignal.addEventListener('abort', onAbort);
  return { signal: controller.signal, detach };
}

function compressionOptions(
  options: UploadOptions | undefined
): Omit<Options, 'output' | 'signal'> {
  const rest: UploadOptions = { ...options };
  delete rest.output;
  delete rest.signal;
  delete rest.bodyLimit;
  return rest;
}

function redactPaths(message: string): string {
  return message
    .replace(/"(?:[A-Za-z]:[\\/]|\/)[^"]*"/g, '"[redacted]"')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:[\w .-]+[\\/])+)[\w .-]+/g, '[redacted]');
}

function clientErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim() === '') {
    return FAILURE;
  }
  return redactPaths(error.message);
}

/**
 * Compress an uploaded PDF for an HTTP response.
 * `output` is refused: the response body is the PDF.
 */
export async function compressUpload(
  body: unknown,
  options: UploadOptions | undefined,
  signal: AbortSignal
): Promise<HttpPdfResponse> {
  const rejected = rejectUploadOptions(options);
  if (rejected) return rejected;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return text(400, 'the request body must be a PDF');
  }
  if (options?.bodyLimit !== undefined && body.length > options.bodyLimit) {
    return bodyTooLarge();
  }

  const linked = linkSignals(signal, options?.signal);
  try {
    const result = await compress(body, {
      ...compressionOptions(options),
      signal: linked.signal,
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
    return text(500, clientErrorMessage(error));
  } finally {
    linked.detach();
  }
}
