import type { UploadOptions } from './types';
import { compressUpload, trackClose, type CloseSource } from './http-compress';

type ExpressRequest = {
  body?: unknown;
};

type ExpressResponse = CloseSource & {
  status(code: number): unknown;
  setHeader(name: string, value: string | number): void;
  send(body: Buffer | string): void;
};

function send(
  res: ExpressResponse,
  status: number,
  contentType: string,
  headers: Record<string, string>,
  body: Buffer | string
): void {
  res.status(status);
  res.setHeader('Content-Type', contentType);
  Object.entries(headers).forEach(([name, value]) => {
    res.setHeader(name, value);
  });
  res.send(body);
}

/**
 * Express handler. The body must already be a Buffer
 * (`express.raw({ type: 'application/pdf' })`).
 * `express.raw({ limit })` is the size limit while the body is read.
 */
export function compressPdf(options?: UploadOptions) {
  return async function compressPdfRoute(
    req: ExpressRequest,
    res: ExpressResponse
  ): Promise<void> {
    const response = trackClose(res);
    if (response.closed()) return;
    const result = await compressUpload(req.body, options, response.signal);
    response.settle();
    if (response.closed()) return;
    send(res, result.status, result.contentType, result.headers, result.body);
  };
}
