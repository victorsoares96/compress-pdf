import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';

function writeFakeGs(dir: string, payload: string): string {
  const bin = path.join(dir, 'fake-gs.js');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const outArg = process.argv.slice(2).find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) {
  fs.writeFileSync(outArg.slice('-sOutputFile='.length), ${JSON.stringify(payload)});
}
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe('compress output option', () => {
  it('writes Ghostscript output to the destination without returning PDF bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-out-'));
    const pdf = path.join(dir, 'in.pdf');
    const destination = path.join(dir, 'out.pdf');
    const input = Buffer.from('%PDF-1.4\n');
    const compressed = '%PDF-1.4 smaller\n';
    fs.writeFileSync(pdf, input);

    const result = await compress(pdf, {
      gsModule: writeFakeGs(dir, compressed),
      output: destination,
    });

    expect(fs.readFileSync(destination, 'utf8')).toBe(compressed);
    expect(result.output).toBe(path.resolve(destination));
    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(compressed.length);
    expect(result.compressionRatio).toBe(compressed.length / input.length);
    expect(result.duration).toEqual(expect.any(Number));
    expect(Buffer.isBuffer(result)).toBe(false);
  });

  it('still returns a Buffer when output is omitted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-out-'));
    const pdf = path.join(dir, 'in.pdf');
    const input = Buffer.from('%PDF-1.4\n');
    const compressed = '%PDF-1.4 smaller\n';
    fs.writeFileSync(pdf, input);

    const result = await compress(pdf, {
      gsModule: writeFakeGs(dir, compressed),
    });

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(Buffer.from(result).toString()).toBe(compressed);
    expect(result.compressedSize).toBe(compressed.length);
  });

  it('replaces the output file with the original when returnOriginalIfLarger is set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-out-'));
    const pdf = path.join(dir, 'in.pdf');
    const destination = path.join(dir, 'out.pdf');
    const input = Buffer.from('%PDF-1.4\n');
    const larger =
      '%PDF-1.4 this output is intentionally larger than the input\n';
    fs.writeFileSync(pdf, input);

    const result = await compress(pdf, {
      gsModule: writeFakeGs(dir, larger),
      output: destination,
      returnOriginalIfLarger: true,
    });

    expect(fs.readFileSync(destination).equals(input)).toBe(true);
    expect(result.output).toBe(path.resolve(destination));
    expect(result.compressedSize).toBe(input.length);
    expect(result.compressionRatio).toBe(1);
  });

  it('writes Buffer input to the destination path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-out-'));
    const destination = path.join(dir, 'nested', 'out.pdf');
    fs.mkdirSync(path.dirname(destination));
    const input = Buffer.from('%PDF-1.4 a longer original document body\n');
    const smaller = '%PDF-1.4\n';

    const result = await compress(input, {
      gsModule: writeFakeGs(dir, smaller),
      output: destination,
    });

    expect(fs.readFileSync(destination, 'utf8')).toBe(smaller);
    expect(result.output).toBe(path.resolve(destination));
    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(smaller.length);
  });
});
