import type { Options } from './types';
import { compressUpload } from './http-compress';

type ExpressRequest = {
  body?: unknown;
  on(event: 'aborted' | 'close', listener: () => void): void;
};

type ExpressResponse = {
  status(code: number): unknown;
  setHeader(name: string, value: string | number): void;
  send(body: Buffer | string): void;
};

function requestSignal(req: ExpressRequest): {
  signal: AbortSignal;
  settle: () => void;
} {
  const controller = new AbortController();
  let settled = false;
  const abort = (): void => {
    if (!settled) {
      controller.abort();
    }
  };
  req.on('aborted', abort);
  req.on('close', abort);
  return {
    signal: controller.signal,
    settle(): void {
      settled = true;
    },
  };
}

/**
 * Express handler. The body must already be a Buffer
 * (`express.raw({ type: 'application/pdf' })`).
 */
export function compressPdf(options?: Options) {
  return async function compressPdfRoute(
    req: ExpressRequest,
    res: ExpressResponse
  ): Promise<void> {
    const request = requestSignal(req);
    const result = await compressUpload(req.body, options, request.signal);
    request.settle();
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    Object.entries(result.headers).forEach(([name, value]) => {
      res.setHeader(name, value);
    });
    res.send(result.body);
  };
}
