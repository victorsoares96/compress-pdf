import type { UploadOptions } from './types';
import {
  bodyTooLarge,
  compressUpload,
  rejectUploadOptions,
  type HttpPdfResponse,
} from './http-compress';

/** Used when `bodyLimit` is omitted. App Router route handlers have no body limit of their own. */
const DEFAULT_BODY_LIMIT = 20 * 1024 * 1024;

type HeaderSource = {
  get(name: string): string | null;
};

type WebRequest = {
  arrayBuffer(): Promise<ArrayBuffer>;
  signal: AbortSignal;
  body?: ReadableStream<Uint8Array> | null;
  headers?: HeaderSource;
};

function toResponse(result: HttpPdfResponse): Response {
  const headers = {
    'Content-Type': result.contentType,
    ...result.headers,
  };
  if (typeof result.body === 'string') {
    return new Response(result.body, { status: result.status, headers });
  }
  return new Response(new Uint8Array(result.body), {
    status: result.status,
    headers,
  });
}

async function readLimitedBody(
  request: WebRequest,
  limit: number
): Promise<Buffer | 'too-large'> {
  const declared = Number(request.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    return 'too-large';
  }
  const stream = request.body;
  if (!stream) {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > limit) return 'too-large';
    return bytes;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const pull = async (): Promise<Buffer | 'too-large'> => {
    const next = await reader.read();
    if (next.done) return Buffer.concat(chunks);
    if (next.value) {
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return 'too-large';
      }
      chunks.push(next.value);
    }
    return pull();
  };
  try {
    return await pull();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Next.js App Router handler. `export const POST = compressPdf(...)`.
 * The request body is the PDF. `bodyLimit` defaults to 20 MiB.
 */
export function compressPdf(options?: UploadOptions) {
  return async function POST(request: WebRequest): Promise<Response> {
    const rejected = rejectUploadOptions(options);
    if (rejected) return toResponse(rejected);
    const limit = options?.bodyLimit ?? DEFAULT_BODY_LIMIT;
    const bytes = await readLimitedBody(request, limit);
    if (bytes === 'too-large') return toResponse(bodyTooLarge());
    const result = await compressUpload(bytes, options, request.signal);
    return toResponse(result);
  };
}
