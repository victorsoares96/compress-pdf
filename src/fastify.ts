import { Readable } from 'node:stream';
import type { UploadOptions } from './types';
import {
  compressUpload,
  positiveLimit,
  trackClose,
  type CloseSource,
} from './http-compress';

const PDF_TYPE = 'application/pdf';
const FASTIFY_DEFAULT_BODY_LIMIT = 1024 * 1024;

type ParserDone = (error: Error | null, body?: Buffer) => void;

type ParserRequest = {
  routeOptions?: {
    bodyLimit?: number;
    handler?: unknown;
  };
  headers?: Record<string, string | string[] | undefined>;
};

type PdfParser = (
  request: ParserRequest,
  payload: unknown,
  done: ParserDone
) => void;

type FastifyApp = {
  initialConfig?: { bodyLimit?: number };
  hasContentTypeParser(contentType: string): boolean;
  addContentTypeParser(contentType: string, parser: PdfParser): void;
};

type FastifyRequest = {
  body?: unknown;
  routeOptions?: { bodyLimit?: number };
  headers?: Record<string, string | string[] | undefined>;
};

type FastifyReply = {
  code(status: number): unknown;
  header(name: string, value: string | number): unknown;
  send(body: Buffer | string): unknown;
  raw: CloseSource;
};

const pdfRoutes = new WeakSet<object>();

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function alreadyRegistered(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'FST_ERR_CTP_ALREADY_PRESENT'
  );
}

function discard(payload: unknown): void {
  if (
    payload &&
    typeof payload === 'object' &&
    'destroy' in payload &&
    typeof (payload as { destroy?: unknown }).destroy === 'function'
  ) {
    (payload as { destroy: () => void }).destroy();
  }
}

function headerValue(
  headers: ParserRequest['headers'],
  name: string
): string | undefined {
  const value = headers?.[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function payloadLimit(
  app: FastifyApp,
  request: ParserRequest | undefined
): number {
  const routeLimit = request?.routeOptions?.bodyLimit;
  if (positiveLimit(routeLimit)) return routeLimit;
  const configured = app.initialConfig?.bodyLimit;
  if (positiveLimit(configured)) return configured;
  return FASTIFY_DEFAULT_BODY_LIMIT;
}

function readPayload(payload: unknown, limit: number, done: ParserDone): void {
  if (Buffer.isBuffer(payload)) {
    if (payload.length > limit) {
      done(httpError('the request body is larger than the limit', 413));
      return;
    }
    done(null, payload);
    return;
  }
  if (!(payload instanceof Readable)) {
    done(new Error('the request body must be a PDF'));
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  let onData: (chunk: Buffer | string | Uint8Array) => void = () => undefined;
  let onEnd: () => void = () => undefined;
  let onError: (error: Error) => void = () => undefined;
  const finish = (error: Error | null, body?: Buffer): void => {
    if (settled) return;
    settled = true;
    payload.off('data', onData);
    payload.off('end', onEnd);
    payload.off('error', onError);
    done(error, body);
  };
  onData = (chunk: Buffer | string | Uint8Array): void => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) {
      payload.destroy();
      finish(httpError('the request body is larger than the limit', 413));
      return;
    }
    chunks.push(buf);
  };
  onEnd = (): void => {
    finish(null, Buffer.concat(chunks));
  };
  onError = (error: Error): void => {
    finish(error);
  };
  payload.on('error', onError);
  payload.on('data', onData);
  payload.on('end', onEnd);
}

/**
 * Register one `application/pdf` parser for this Fastify context.
 * Routes that did not call `compressPdf` still get 415.
 * The route `bodyLimit` is enforced here because a custom parser
 * does not inherit it from Fastify.
 */
function ensurePdfParser(app: FastifyApp, handler: object): void {
  pdfRoutes.add(handler);
  if (app.hasContentTypeParser(PDF_TYPE)) return;
  try {
    app.addContentTypeParser(PDF_TYPE, (request, payload, done) => {
      const routeHandler = request?.routeOptions?.handler;
      if (typeof routeHandler === 'function' && !pdfRoutes.has(routeHandler)) {
        discard(payload);
        done(httpError('Unsupported Media Type', 415));
        return;
      }
      const declared = Number(headerValue(request?.headers, 'content-length'));
      const limit = payloadLimit(app, request);
      if (Number.isFinite(declared) && declared > limit) {
        discard(payload);
        done(httpError('the request body is larger than the limit', 413));
        return;
      }
      readPayload(payload, limit, done);
    });
  } catch (error) {
    if (!alreadyRegistered(error)) throw error;
  }
}

function send(
  reply: FastifyReply,
  status: number,
  contentType: string,
  headers: Record<string, string>,
  body: Buffer | string
): void {
  reply.code(status);
  reply.header('Content-Type', contentType);
  Object.entries(headers).forEach(([name, value]) => {
    reply.header(name, value);
  });
  reply.send(body);
}

/**
 * Fastify route options for `app.post('/compress', compressPdf())`.
 * Registers an `application/pdf` parser when the app does not have one.
 * Pass `bodyLimit` here or on the route. Otherwise the Fastify instance limit is used.
 */
export function compressPdf(options?: UploadOptions) {
  async function handler(
    this: FastifyApp,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const response = trackClose(reply.raw);
    if (response.closed()) return;
    const result = await compressUpload(request.body, options, response.signal);
    response.settle();
    if (response.closed()) return;
    send(reply, result.status, result.contentType, result.headers, result.body);
  }

  const bodyLimit = options?.bodyLimit;
  return {
    ...(positiveLimit(bodyLimit) ? { bodyLimit } : {}),
    async onRequest(this: FastifyApp): Promise<void> {
      ensurePdfParser(this, handler);
    },
    handler,
  };
}
