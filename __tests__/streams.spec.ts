import { buffer as readToBuffer } from 'node:stream/consumers';
import { Readable } from 'node:stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import analyze from '../src/analyze';
import compress, { compressStream } from '../src/compress';
import split from '../src/split';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-stream-'));
}

function writeFakeGs(dir: string, pageCount: number): string {
  const bin = path.join(dir, 'fake-gs.js');
  const log = path.join(dir, 'args.txt');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join('\\n') + '\\n---\\n');
args.forEach((arg) => {
  if (arg.startsWith('-')) return;
  if (fs.existsSync(arg)) {
    fs.appendFileSync(${JSON.stringify(path.join(dir, 'bodies.txt'))}, fs.readFileSync(arg));
    fs.appendFileSync(${JSON.stringify(path.join(dir, 'bodies.txt'))}, '\\n--FILE--\\n');
  }
});
if (args.includes('-dPDFINFO')) {
  console.log('File has ${pageCount} pages');
  process.exit(0);
}
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) {
  fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4 fake\\n');
}
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function bodies(dir: string): string {
  const log = path.join(dir, 'bodies.txt');
  if (!fs.existsSync(log)) return '';
  return fs.readFileSync(log, 'utf8');
}

function recordedCalls(dir: string): string[][] {
  const log = path.join(dir, 'args.txt');
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf8')
    .split('---\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => chunk.trim().split('\n'));
}

describe('more PDF inputs', () => {
  it('writes only the bytes of a Uint8Array view', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 1);
    const backing = Buffer.from('XXXX%PDF-viewYYYY');
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 4, 9);

    await compress(view, { gsModule: bin });

    expect(bodies(dir)).toContain('%PDF-view');
    expect(bodies(dir)).not.toContain('XXXX');
    expect(bodies(dir)).not.toContain('YYYY');
  });

  it('accepts an ArrayBuffer, a Node stream, and a web stream', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 1);
    const arrayBuffer = Uint8Array.from(Buffer.from('%PDF-array\n')).buffer;
    const nodeStream = Readable.from([Buffer.from('%PDF-node\n')]);
    const webStream = Readable.toWeb(
      Readable.from([Buffer.from('%PDF-web\n')])
    );

    await compress(arrayBuffer, { gsModule: bin });
    await compress(nodeStream, { gsModule: bin });
    await compress(webStream, { gsModule: bin });

    const seen = bodies(dir);
    expect(seen).toContain('%PDF-array');
    expect(seen).toContain('%PDF-node');
    expect(seen).toContain('%PDF-web');
  });

  it('rejects an empty byte view and an empty stream before Ghostscript', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 1);

    await expect(compress(new Uint8Array(), { gsModule: bin })).rejects.toThrow(
      /empty/
    );
    await expect(
      compress(new ArrayBuffer(0), { gsModule: bin })
    ).rejects.toThrow(/empty/);
    await expect(
      compress(Readable.from([]), { gsModule: bin })
    ).rejects.toThrow(/empty/);
    expect(recordedCalls(dir)).toHaveLength(0);
  });

  it('analyzes a byte view', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 2);
    const bytes = new Uint8Array(Buffer.from('%PDF-1.4\n'));

    const info = await analyze(bytes, { gsModule: bin });

    expect(info.pages).toBe(2);
  });

  it('reads a stream once when splitting', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 2);
    let pulls = 0;
    const stream = Readable.from(
      (async function* source() {
        pulls += 1;
        yield Buffer.from('%PDF-1.4 once\n');
      })()
    );

    const result = await split(stream, {
      gsModule: bin,
      output: path.join(dir, 'page-%d.pdf'),
    });

    expect(pulls).toBe(1);
    expect(result.files).toEqual([
      path.join(dir, 'page-1.pdf'),
      path.join(dir, 'page-2.pdf'),
    ]);
    expect(fs.existsSync(result.files[0])).toBe(true);
    expect(fs.existsSync(result.files[1])).toBe(true);
  });
});

describe('compressStream', () => {
  it('returns the finished PDF after Ghostscript, then deletes the temp file', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 1);
    const input = Buffer.from('%PDF-1.4 source-bytes-long-enough\n');

    const pdf = await compressStream(input, { gsModule: bin });
    const stored = (pdf as unknown as fs.ReadStream).path;
    const closed = new Promise((resolve) => {
      pdf.on('close', resolve);
    });
    const body = await readToBuffer(pdf);

    expect(body.toString()).toBe('%PDF-1.4 fake\n');
    expect(pdf.originalSize).toBe(input.length);
    expect(pdf.compressedSize).toBe(body.length);
    await closed;
    expect(fs.existsSync(stored)).toBe(false);
  });

  it('rejects output before Ghostscript runs', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 1);

    await expect(
      compressStream(Buffer.from('%PDF-1.4\n'), {
        gsModule: bin,
        output: path.join(dir, 'out.pdf'),
      })
    ).rejects.toThrow(/output cannot be used/);
    expect(recordedCalls(dir)).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'out.pdf'))).toBe(false);
  });

  it('can carry the original bytes when compression is not smaller', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 1);
    const input = Buffer.from('%PDF\n');

    const pdf = await compressStream(input, {
      gsModule: bin,
      returnOriginalIfLarger: true,
    });
    const body = await readToBuffer(pdf);

    expect(body.equals(input)).toBe(true);
  });
});
