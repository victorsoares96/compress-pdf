import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
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
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as Buffer | string | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      this.headers[name.toLowerCase()] = String(value);
    },
    send(body: Buffer | string) {
      this.body = body;
    },
  };
  return { req, res };
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

    await expressCompress({ resolution: 'ebook' })(req, res);

    expect(compressMock).toHaveBeenCalledWith(
      req.body,
      expect.objectContaining({ resolution: 'ebook' })
    );
    expect(compressMock.mock.calls[0][1]).not.toHaveProperty('output');
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

  it('returns the Ghostscript message without a stack', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    const error = new CompressPdfError('ghostscript vanished');
    error.stack = 'ghostscript vanished\n    at secret-stack';
    compressMock.mockRejectedValue(error);

    await expressCompress()(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('ghostscript vanished');
    expect(String(res.body)).not.toContain('secret-stack');
  });

  it('aborts Ghostscript when the Express request is aborted', async () => {
    const { req, res } = expressPair();
    req.body = Buffer.from('%PDF-in');
    const user = new AbortController();
    compressMock.mockImplementation(async (_file, options) => {
      req.emit('aborted');
      user.abort();
      expect(options?.signal?.aborted).toBe(true);
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });

    await expressCompress({ signal: user.signal })(req, res);
    expect(compressMock).toHaveBeenCalledOnce();
  });

  it('registers a Fastify PDF parser once and compresses the body', async () => {
    const added: string[] = [];
    const app = {
      hasContentTypeParser(type: string) {
        return added.includes(type);
      },
      addContentTypeParser(
        type: string,
        _options: { parseAs: string },
        parser: (
          request: unknown,
          payload: Buffer,
          done: (error: Error | null, body?: Buffer) => void
        ) => void
      ) {
        added.push(type);
        parser(undefined, Buffer.from('pdf'), (error, body) => {
          expect(error).toBeNull();
          expect(body).toEqual(Buffer.from('pdf'));
        });
      },
    };
    const route = fastifyCompress({ resolution: 'screen' });
    await route.onRequest.call(app);
    await route.onRequest.call(app);
    expect(added).toEqual(['application/pdf']);

    const raw = new EventEmitter();
    const reply = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: undefined as Buffer | string | undefined,
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
    compressMock.mockImplementation(async () => {
      raw.emit('aborted');
      return pdfResult(Buffer.from('%PDF-out')) as never;
    });
    await route.handler.call(app, { body: Buffer.from('%PDF-in'), raw }, reply);

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

  it('keeps going when Fastify already has the PDF parser', async () => {
    const route = fastifyCompress();
    const app = {
      hasContentTypeParser() {
        return false;
      },
      addContentTypeParser() {
        throw new Error('already registered');
      },
    };
    await expect(route.onRequest.call(app)).resolves.toBeUndefined();
  });

  it('rejects output on a Next.js request before Ghostscript', async () => {
    const POST = nextCompress({ output: 'out.pdf' });
    const response = await POST(
      new Request('http://localhost/compress', {
        method: 'POST',
        body: Buffer.alloc(0),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('output cannot be used');
    expect(compressMock).not.toHaveBeenCalled();
  });
});
