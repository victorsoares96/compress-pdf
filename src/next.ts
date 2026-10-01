import type { Options } from './types';
import { compressUpload, type HttpPdfResponse } from './http-compress';

type WebRequest = {
  arrayBuffer(): Promise<ArrayBuffer>;
  signal: AbortSignal;
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

/**
 * Next.js App Router handler. `export const POST = compressPdf(...)`.
 * The request body is the PDF.
 */
export function compressPdf(options?: Options) {
  return async function POST(request: WebRequest): Promise<Response> {
    const bytes = Buffer.from(await request.arrayBuffer());
    const result = await compressUpload(bytes, options, request.signal);
    return toResponse(result);
  };
}
