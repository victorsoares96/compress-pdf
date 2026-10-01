import fs from 'fs';
import os from 'os';
import path from 'path';
import { MessageChannel } from 'worker_threads';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';

function writeFakeGs(dir: string): string {
  const bin = path.join(dir, 'fake-gs.js');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const outArg = process.argv.slice(2).find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) {
  fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4 fake\\n');
}
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe('compress result', () => {
  it('keeps the native ArrayBuffer and the compression metadata', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-buf-'));
    const pdf = path.join(dir, 'in.pdf');
    const input = Buffer.from('%PDF-1.4\n');
    fs.writeFileSync(pdf, input);

    const result = await compress(pdf, { gsModule: writeFakeGs(dir) });

    const { buffer } = result;
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(result.length);
    expect(result.compressionRatio).toBe(
      result.compressedSize / result.originalSize
    );
    expect(result.duration).toEqual(expect.any(Number));

    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error('expected an ArrayBuffer');
    }
    const { port1 } = new MessageChannel();
    expect(() => port1.postMessage(buffer, [buffer])).not.toThrow();
  });
});
