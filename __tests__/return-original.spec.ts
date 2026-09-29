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

describe('returnOriginalIfLarger', () => {
  it('keeps the larger Ghostscript output when the option is off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-roi-'));
    const pdf = path.join(dir, 'in.pdf');
    const input = Buffer.from('%PDF-1.4\n');
    fs.writeFileSync(pdf, input);
    const larger =
      '%PDF-1.4 this output is intentionally larger than the input\n';

    const result = await compress(pdf, {
      gsModule: writeFakeGs(dir, larger),
    });

    expect(Buffer.from(result).toString()).toBe(larger);
    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(larger.length);
    expect(result.compressedSize).toBeGreaterThan(result.originalSize);
  });

  it('returns the original bytes when Ghostscript output is larger', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-roi-'));
    const pdf = path.join(dir, 'in.pdf');
    const input = Buffer.from('%PDF-1.4\n');
    fs.writeFileSync(pdf, input);
    const larger =
      '%PDF-1.4 this output is intentionally larger than the input\n';

    const result = await compress(pdf, {
      gsModule: writeFakeGs(dir, larger),
      returnOriginalIfLarger: true,
    });

    expect(Buffer.from(result).equals(input)).toBe(true);
    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(input.length);
    expect(result.compressionRatio).toBe(1);
    expect(result.duration).toEqual(expect.any(Number));
  });

  it('returns the original Buffer when output is the same size but different bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-roi-'));
    const input = Buffer.from('%PDF-1.4 original!\n');
    const sameSize = '%PDF-1.4 different\n';
    expect(sameSize.length).toBe(input.length);

    const result = await compress(input, {
      gsModule: writeFakeGs(dir, sameSize),
      returnOriginalIfLarger: true,
    });

    expect(Buffer.from(result).equals(input)).toBe(true);
    expect(Buffer.from(result).toString()).not.toBe(sameSize);
    expect(result).not.toBe(input);
    expect(result.compressedSize).toBe(input.length);
    expect(result.compressionRatio).toBe(1);
  });

  it('still returns a smaller Ghostscript output when the option is on', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-roi-'));
    const input = Buffer.from('%PDF-1.4 a longer original document body\n');
    const smaller = '%PDF-1.4\n';

    const result = await compress(input, {
      gsModule: writeFakeGs(dir, smaller),
      returnOriginalIfLarger: true,
    });

    expect(Buffer.from(result).toString()).toBe(smaller);
    expect(result.compressedSize).toBe(smaller.length);
    expect(result.compressedSize).toBeLessThan(result.originalSize);
  });
});
