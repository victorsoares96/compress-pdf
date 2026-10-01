import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import compress from '@/compress';
import { compressPdf as expressCompress } from '../src/express';
import { compressPdf as fastifyCompress } from '../src/fastify';
import { compressPdf as nextCompress } from '../src/next';
import { CompressPdfError } from '../src/types';

vi.mock('@/compress', () => ({
  default: vi.fn(),
}));

const compressMock = vi.mocked(compress);

function pdfResult(bytes: Buffer) {
  const originalSize = 2048;
  const compressedSize = bytes.length;
  return Object.assign(bytes, {
    originalSize,
    compressedSize,
    compressionRatio: compressedSize / originalSize,
    duration: 4,
  });
}

function expressPair() {
  const req = new EventEmitter() as EventEmitter & { body?: unknown };
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
    body?: Buffer | string;
    writableFinished: boolean;
    destroyed: boolean;
    status(code: number): typeof res;
    setHeader(name: string, value: string | number): void;
    send(body: Buffer | string): void;
  };
  res.statusCode = 0;
  res.headers = {};
  res.writableFinished = false;
  res.destroyed = false;
  res.status = function status(code: number) {
    this.statusCode = code;
    return this;
  };
  res.setHeader = function setHeader(name: string, value: string | number) {
    this.headers[name.toLowerCase()] = String(value);
  };
  res.send = function send(body: Buffer | string) {
    this.body = body;
  };
  return { req, res };
}

function fastifyReply() {
  const raw = new EventEmitter() as EventEmitter & {
    writableFinished: boolean;
    destroyed: boolean;
  };
  raw.writableFinished = false;
  raw.destroyed = false;
  const reply = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as Buffer | string | undefined,
    raw,
    code(status: number) {
      this.statusCode = status;
    },
    header(name: string, value: string | number) {
      this.headers[name.toLowerCase()] = String(value);
    },
    send(body: Buffer | string) {
      this.body = body;
    },
  };
  return reply;
}

describe('http adapters', () => {
  beforeEach(() => {
    compressMock.mockReset();
  });

  it('does not import Express, Fastify, or Next', () => {
    [
      'index.ts',
      'express.ts',
      'fastify.ts',
      'next.ts',
      'http-compress.ts',
    ].forEach((name) => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src', name),
        'utf8'
      );
      expect(source).not.toMatch(/from ['"](?:express|fastify|next)['"]/);
    });
  });

  it('compresses an Express PDF body and returns the sizes', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    compressMock.mockImplementation(async (_file, options) => {
      expect(options?.signal?.aborted).toBe(false);
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });

    await expressCompress({ resolution: 'ebook', bodyLimit: 100 })(req, res);

    expect(compressMock).toHaveBeenCalledWith(
      req.body,
      expect.objectContaining({ resolution: 'ebook' })
    );
    expect(compressMock.mock.calls[0][1]).not.toHaveProperty('output');
    expect(compressMock.mock.calls[0][1]).not.toHaveProperty('bodyLimit');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-original-size']).toBe('2048');
    expect(res.headers['x-compressed-size']).toBe(
      String(Buffer.from('%PDF-out').length)
    );
    expect(res.headers['x-compression-ratio']).toBe(
      String(Buffer.from('%PDF-out').length / 2048)
    );
    expect(Buffer.compare(res.body as Buffer, Buffer.from('%PDF-out'))).toBe(0);
  });

  it('rejects an empty Express body and output before Ghostscript', async () => {
    const empty = expressPair();
    empty.req.body = Buffer.alloc(0);
    const emptyCode = await expressCompress()(empty.req, empty.res);
    expect(emptyCode).toBeUndefined();
    expect(empty.res.statusCode).toBe(400);
    expect(empty.res.body).toBe('the request body must be a PDF');

    const output = expressPair();
    output.req.body = Buffer.from('%PDF-in');
    await expressCompress({ output: 'out.pdf' })(output.req, output.res);
    expect(output.res.statusCode).toBe(400);
    expect(String(output.res.body)).toContain('output cannot be used');
    expect(compressMock).not.toHaveBeenCalled();
  });

  it('rejects a bodyLimit that is not a positive number', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    await expressCompress({ bodyLimit: 0 })(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('bodyLimit must be a positive number');
    expect(compressMock).not.toHaveBeenCalled();
  });

  it('hides a non-error Ghostscript failure', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    compressMock.mockRejectedValue('nope');
    await expressCompress()(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Ghostscript failed to compress the PDF.');
  });

  it('rejects an Express body larger than bodyLimit', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    await expressCompress({ bodyLimit: 4 })(req, res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toBe('the request body is larger than the limit');
    expect(compressMock).not.toHaveBeenCalled();
  });

  it('returns the Ghostscript message without a stack or a path', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    const error = new CompressPdfError(
      'Ghostscript was not found at "C:\\Program Files\\gs\\gswin64c.exe". Set COMPRESS_PDF_BIN_PATH to the Ghostscript binary, or install Ghostscript manually.'
    );
    error.stack = 'ghostscript vanished\n    at secret-stack';
    compressMock.mockRejectedValue(error);

    await expressCompress()(req, res);

    expect(res.statusCode).toBe(500);
    expect(String(res.body)).toContain('COMPRESS_PDF_BIN_PATH');
    expect(String(res.body)).not.toContain('gswin64c');
    expect(String(res.body)).not.toContain('secret-stack');
    expect(String(res.body)).not.toContain('C:\\');
  });

  it('aborts Ghostscript when the Express response closes', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    compressMock.mockImplementation(async (_file, options) => {
      res.emit('close');
      expect(options?.signal?.aborted).toBe(true);
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });

    await expressCompress()(req, res);
    expect(compressMock).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    expect(res.body).toBeUndefined();
  });

  it('aborts Ghostscript when a real HTTP client disconnects', async () => {
    let releaseStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    let handlerDone: () => void = () => {};
    const handled = new Promise<void>((resolve) => {
      handlerDone = resolve;
    });
    compressMock.mockImplementation(
      (_file, options) =>
        new Promise((resolve) => {
          releaseStarted();
          const finish = (): void => {
            expect(options?.signal?.aborted).toBe(true);
            resolve(pdfResult(Buffer.from('%PDF-out')) as never);
          };
          if (options?.signal?.aborted) {
            finish();
            return;
          }
          options?.signal?.addEventListener('abort', finish, { once: true });
        })
    );

    const server = http.createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on('end', () => resolve());
          req.on('error', reject);
        });
        await expressCompress()(
          { body: Buffer.concat(chunks) },
          {
            get writableFinished() {
              return res.writableFinished;
            },
            get destroyed() {
              return res.destroyed;
            },
            on(event: 'close', listener: () => void) {
              res.on(event, listener);
            },
            off(event: 'close', listener: () => void) {
              res.off(event, listener);
            },
            status() {
              return this;
            },
            setHeader() {},
            send() {
              throw new Error('send after disconnect');
            },
          }
        );
      } finally {
        handlerDone();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server has no port');
    }
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${address.port}/compress`, {
      method: 'POST',
      body: Buffer.from('%PDF-in'),
      headers: { 'content-type': 'application/pdf' },
      signal: controller.signal,
    }).then(
      () => 'completed',
      () => 'aborted'
    );
    await started;
    controller.abort();
    await handled;
    await expect(pending).resolves.toBe('aborted');
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('drops the caller signal listener after the response', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    const user = new AbortController();
    let linked: AbortSignal | undefined;
    compressMock.mockImplementation(async (_file, options) => {
      linked = options?.signal;
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });

    await expressCompress({ signal: user.signal })(req, res);
    expect(linked?.aborted).toBe(false);
    user.abort();
    expect(linked?.aborted).toBe(false);
    expect(res.statusCode).toBe(200);
  });

  it('returns 500 when the caller signal aborts and the client is still connected', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    const user = new AbortController();
    compressMock.mockImplementation(async (_file, options) => {
      user.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw new CompressPdfError('Ghostscript compression was aborted.');
    });

    await expressCompress({ signal: user.signal })(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Ghostscript compression was aborted.');
  });

  it('ignores a response close after the PDF is sent', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    res.off = function off(this: typeof res) {
      this.emit('close');
      return this;
    } as typeof res.off;
    compressMock.mockResolvedValue(pdfResult(Buffer.from('%PDF-out')) as never);
    await expressCompress()(req, res);
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.body as Buffer, Buffer.from('%PDF-out'))).toBe(0);
  });

  it('skips Ghostscript when the Express response is already closed', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    res.destroyed = true;
    await expressCompress()(req, res);
    expect(compressMock).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });

  it('registers a Fastify PDF parser once and compresses the body', async () => {
    const added: string[] = [];
    const app = {
      initialConfig: { bodyLimit: 1024 * 1024 },
      hasContentTypeParser(type: string) {
        return added.includes(type);
      },
      addContentTypeParser(
        type: string,
        parser: (
          request: {
            routeOptions?: { bodyLimit?: number; handler?: unknown };
          },
          payload: unknown,
          done: (error: Error | null, body?: Buffer) => void
        ) => void
      ) {
        added.push(type);
        parser({}, Buffer.from('pdf'), (error, body) => {
          expect(error).toBeNull();
          expect(body).toEqual(Buffer.from('pdf'));
        });
      },
    };
    const route = fastifyCompress({ resolution: 'screen' });
    expect(route).not.toHaveProperty('bodyLimit');
    await route.onRequest.call(app);
    await route.onRequest.call(app);
    expect(added).toEqual(['application/pdf']);

    const reply = fastifyReply();
    compressMock.mockResolvedValue(pdfResult(Buffer.from('%PDF-out')) as never);
    await route.handler.call(app, { body: Buffer.from('%PDF-in') }, reply);

    expect(compressMock).toHaveBeenCalledWith(
      Buffer.from('%PDF-in'),
      expect.objectContaining({ resolution: 'screen' })
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('application/pdf');
    expect(reply.headers['x-original-size']).toBe('2048');
    expect(Buffer.compare(reply.body as Buffer, Buffer.from('%PDF-out'))).toBe(
      0
    );
  });

  it('sets the Fastify route bodyLimit from options', () => {
    const route = fastifyCompress({ bodyLimit: 4096 });
    expect(route.bodyLimit).toBe(4096);
  });

  it('enforces the Fastify route body limit while reading', async () => {
    let parse: (
      request: {
        routeOptions?: { bodyLimit?: number; handler?: unknown };
        headers?: Record<string, string>;
      },
      payload: unknown,
      done: (error: Error | null, body?: Buffer) => void
    ) => void = () => {};
    const app = {
      hasContentTypeParser() {
        return false;
      },
      addContentTypeParser(_type: string, parser: typeof parse) {
        parse = parser;
      },
    };
    const route = fastifyCompress();
    await route.onRequest.call(app);

    const small = await new Promise<{
      error: Error | null;
      body?: Buffer;
    }>((resolve) => {
      parse(
        { routeOptions: { bodyLimit: 4, handler: route.handler } },
        Readable.from([Buffer.from('abcd')]),
        (error, body) => resolve({ error, body })
      );
    });
    expect(small.error).toBeNull();
    expect(small.body).toEqual(Buffer.from('abcd'));

    const large = await new Promise<Error | null>((resolve) => {
      parse(
        { routeOptions: { bodyLimit: 4, handler: route.handler } },
        Readable.from([Buffer.from('abcdef')]),
        (error) => resolve(error)
      );
    });
    expect(large).toMatchObject({ statusCode: 413 });

    const foreign = await new Promise<Error | null>((resolve) => {
      parse(
        { routeOptions: { bodyLimit: 100, handler() {} } },
        Readable.from([Buffer.from('pdf')]),
        (error) => resolve(error)
      );
    });
    expect(foreign).toMatchObject({ statusCode: 415 });

    const declared = await new Promise<Error | null>((resolve) => {
      parse(
        {
          routeOptions: { bodyLimit: 4, handler: route.handler },
          headers: { 'content-length': '10' },
        },
        Readable.from([Buffer.from('hi')]),
        (error) => resolve(error)
      );
    });
    expect(declared).toMatchObject({ statusCode: 413 });

    const buffer = await new Promise<Error | null>((resolve) => {
      parse(
        { routeOptions: { bodyLimit: 4, handler: route.handler } },
        Buffer.from('abcdef'),
        (error) => resolve(error)
      );
    });
    expect(buffer).toMatchObject({ statusCode: 413 });

    const broken = await new Promise<Error | null>((resolve) => {
      parse(
        { routeOptions: { handler: route.handler, bodyLimit: 100 } },
        { pipe: true },
        (error) => resolve(error)
      );
    });
    expect(broken?.message).toBe('the request body must be a PDF');

    const failed = await new Promise<Error | null>((resolve) => {
      const stream = new Readable({
        read() {
          this.destroy(new Error('socket reset'));
        },
      });
      parse(
        { routeOptions: { handler: route.handler, bodyLimit: 100 } },
        stream,
        (error) => resolve(error)
      );
    });
    expect(failed?.message).toBe('socket reset');

    const fallback = await new Promise<{
      error: Error | null;
      body?: Buffer;
    }>((resolve) => {
      parse({}, Buffer.from('pdf'), (error, body) => resolve({ error, body }));
    });
    expect(fallback.error).toBeNull();
    expect(fallback.body).toEqual(Buffer.from('pdf'));
  });

  it('aborts Ghostscript when the Fastify response closes', async () => {
    const app = {
      hasContentTypeParser() {
        return true;
      },
      addContentTypeParser() {
        throw new Error('parser should stay untouched');
      },
    };
    const route = fastifyCompress();
    await route.onRequest.call(app);
    const reply = fastifyReply();
    compressMock.mockImplementation(async (_file, options) => {
      reply.raw.emit('close');
      expect(options?.signal?.aborted).toBe(true);
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });

    await route.handler.call(app, { body: Buffer.from('%PDF-in') }, reply);
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeUndefined();
  });

  it('leaves an existing Fastify PDF parser in place', async () => {
    const route = fastifyCompress();
    const app = {
      hasContentTypeParser() {
        return true;
      },
      addContentTypeParser() {
        throw new Error('already registered');
      },
    };
    await expect(route.onRequest.call(app)).resolves.toBeUndefined();
  });

  it('ignores only a parallel Fastify parser registration', async () => {
    const route = fastifyCompress();
    const parallel = {
      hasContentTypeParser() {
        return false;
      },
      addContentTypeParser() {
        const error = new Error('already registered');
        Object.assign(error, { code: 'FST_ERR_CTP_ALREADY_PRESENT' });
        throw error;
      },
    };
    await expect(route.onRequest.call(parallel)).resolves.toBeUndefined();

    const broken = fastifyCompress();
    const app = {
      hasContentTypeParser() {
        return false;
      },
      addContentTypeParser() {
        throw new Error('parser rejected');
      },
    };
    await expect(broken.onRequest.call(app)).rejects.toThrow('parser rejected');
  });

  it('compresses a Next.js request body', async () => {
    compressMock.mockResolvedValue(pdfResult(Buffer.from('%PDF-out')) as never);
    const POST = nextCompress({ resolution: 'ebook' });
    const response = await POST(
      new Request('http://localhost/compress', {
        method: 'POST',
        body: Buffer.from('%PDF-in'),
        headers: { 'content-type': 'application/pdf' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('x-original-size')).toBe('2048');
    expect(response.headers.get('x-compressed-size')).toBe(
      String(Buffer.from('%PDF-out').length)
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from('%PDF-out')
    );
    expect(compressMock).toHaveBeenCalledWith(
      Buffer.from('%PDF-in'),
      expect.objectContaining({ resolution: 'ebook' })
    );
  });

  it('aborts Ghostscript when the Next.js request is aborted', async () => {
    const controller = new AbortController();
    compressMock.mockImplementation(async (_file, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });
    const POST = nextCompress();
    const response = await POST(
      new Request('http://localhost/compress', {
        method: 'POST',
        body: Buffer.from('%PDF-in'),
        signal: controller.signal,
      })
    );
    expect(response.status).toBe(200);
    expect(compressMock).toHaveBeenCalledOnce();
  });

  it('stops reading a Next.js body past bodyLimit', async () => {
    let reads = 0;
    const POST = nextCompress({ bodyLimit: 4 });
    const response = await POST({
      signal: new AbortController().signal,
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              if (reads === 1) {
                return { done: false, value: new Uint8Array([1, 2, 3, 4, 5]) };
              }
              return { done: true, value: undefined };
            },
            async cancel() {
              return undefined;
            },
            releaseLock() {
              return undefined;
            },
          };
        },
      } as unknown as ReadableStream<Uint8Array>,
      arrayBuffer() {
        throw new Error('arrayBuffer was used');
      },
    });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe(
      'the request body is larger than the limit'
    );
    expect(reads).toBe(1);
    expect(compressMock).not.toHaveBeenCalled();
  });

  it('rejects a Next.js content-length above bodyLimit before reading', async () => {
    const POST = nextCompress({ bodyLimit: 4 });
    const response = await POST({
      signal: new AbortController().signal,
      headers: {
        get: (name: string) => (name === 'content-length' ? '50' : null),
      },
      get body(): ReadableStream<Uint8Array> {
        throw new Error('body was read');
      },
      arrayBuffer() {
        throw new Error('body was read');
      },
    });
    expect(response.status).toBe(413);
    expect(compressMock).not.toHaveBeenCalled();
  });

  it('treats an already aborted request as aborted', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    const user = new AbortController();
    user.abort();
    compressMock.mockImplementation(async (_file, options) => {
      expect(options?.signal?.aborted).toBe(true);
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });

    await expressCompress({ signal: user.signal })(req, res);
    expect(compressMock).toHaveBeenCalledOnce();
  });

  it('reads a Next.js body that has no stream', async () => {
    compressMock.mockResolvedValue(pdfResult(Buffer.from('%PDF-out')) as never);
    const POST = nextCompress();
    const response = await POST({
      signal: new AbortController().signal,
      headers: { get: () => null },
      body: null,
      async arrayBuffer() {
        const bytes = Buffer.from('%PDF-in');
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
      },
    });
    expect(response.status).toBe(200);
    expect(compressMock).toHaveBeenCalledOnce();

    compressMock.mockClear();
    const limited = nextCompress({ bodyLimit: 4 });
    const rejected = await limited({
      signal: new AbortController().signal,
      body: null,
      async arrayBuffer() {
        return Uint8Array.from([1, 2, 3, 4, 5]).buffer;
      },
    });
    expect(rejected.status).toBe(413);
    expect(compressMock).not.toHaveBeenCalled();
  });

  it('rejects output on a Next.js request before reading the body', async () => {
    const POST = nextCompress({ output: 'out.pdf' });
    const request = {
      signal: new AbortController().signal,
      headers: { get: () => null },
      get body(): ReadableStream<Uint8Array> {
        throw new Error('body was read');
      },
      arrayBuffer() {
        throw new Error('body was read');
      },
    };
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('output cannot be used');
    expect(compressMock).not.toHaveBeenCalled();
  });
});
