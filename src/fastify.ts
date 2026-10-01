import type { Options } from './types';
import { compressUpload } from './http-compress';

type FastifyApp = {
  hasContentTypeParser(contentType: string): boolean;
  addContentTypeParser(
    contentType: string,
    options: { parseAs: 'buffer' },
    parser: (
      request: unknown,
      payload: Buffer,
      done: (error: Error | null, body?: Buffer) => void
    ) => void
  ): void;
};

type FastifyRequest = {
  body?: unknown;
  raw: {
    on(event: 'aborted' | 'close', listener: () => void): void;
  };
};

type FastifyReply = {
  code(status: number): unknown;
  header(name: string, value: string | number): unknown;
  send(body: Buffer | string): unknown;
};

function ensurePdfParser(app: FastifyApp): void {
  if (app.hasContentTypeParser('application/pdf')) {
    return;
  }
  try {
    app.addContentTypeParser(
      'application/pdf',
      { parseAs: 'buffer' },
      (_request, payload, done) => {
        done(null, payload);
      }
    );
  } catch {
    // A parallel request registered the same parser.
  }
}

function requestSignal(raw: FastifyRequest['raw']): {
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
  raw.on('aborted', abort);
  raw.on('close', abort);
  return {
    signal: controller.signal,
    settle(): void {
      settled = true;
    },
  };
}

/**
 * Fastify route options for `app.post('/compress', compressPdf())`.
 * Registers an `application/pdf` parser when the app does not have one.
 * The body limit stays the one Fastify already uses.
 */
export function compressPdf(options?: Options) {
  return {
    async onRequest(this: FastifyApp): Promise<void> {
      ensurePdfParser(this);
    },
    async handler(
      this: FastifyApp,
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> {
      const incoming = requestSignal(request.raw);
      const result = await compressUpload(
        request.body,
        options,
        incoming.signal
      );
      incoming.settle();
      reply.code(result.status);
      reply.header('Content-Type', result.contentType);
      Object.entries(result.headers).forEach(([name, value]) => {
        reply.header(name, value);
      });
      reply.send(result.body);
    },
  };
}
