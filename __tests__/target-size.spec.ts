import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';
import { CompressPdfError } from '../src/types';

function writeLadderGs(dir: string): string {
  const bin = path.join(dir, 'fake-gs.js');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const dpiArg = args.find((arg) => arg.startsWith('-dColorImageResolution='));
const presetArg = args.find((arg) => arg.startsWith('-dPDFSETTINGS='));
if (!outArg) process.exit(1);
const dpi = Number((dpiArg || '').slice('-dColorImageResolution='.length));
const preset = (presetArg || '').slice('-dPDFSETTINGS=/'.length);
let size = 2000;
if (dpi <= 72) size = 800;
if (dpi <= 50) size = 400;
if (preset === 'screen') size = Math.min(size, 300);
if (preset === 'screen' && dpi <= 50) size = 150;
fs.writeFileSync(outArg.slice('-sOutputFile='.length), 'x'.repeat(size));
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe('targetSize', () => {
  it('rejects a non-positive or non-finite targetSize', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-ts-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await expect(
      compress(pdf, { gsModule: writeLadderGs(dir), targetSize: 0 })
    ).rejects.toBeInstanceOf(CompressPdfError);
    await expect(
      compress(pdf, { gsModule: writeLadderGs(dir), targetSize: NaN })
    ).rejects.toBeInstanceOf(CompressPdfError);
    await expect(
      compress(pdf, { gsModule: writeLadderGs(dir), targetSize: -1 })
    ).rejects.toBeInstanceOf(CompressPdfError);
  });

  it('stops when an attempt fits under targetSize', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-ts-'));
    const input = Buffer.from('%PDF-1.4 original document body\n');
    const gs = writeLadderGs(dir);

    const result = await compress(input, {
      gsModule: gs,
      targetSize: 500,
    });

    expect(result.compressedSize).toBeLessThanOrEqual(500);
    expect(result.compressedSize).toBe(400);
    expect(result.originalSize).toBe(input.length);
    expect(result.duration).toEqual(expect.any(Number));
  });

  it('returns the smallest attempt when none fit under targetSize', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-ts-'));
    const input = Buffer.from('%PDF-1.4 original document body\n');

    const result = await compress(input, {
      gsModule: writeLadderGs(dir),
      targetSize: 10,
    });

    expect(result.compressedSize).toBe(150);
  });

  it('writes the chosen attempt when output is set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-ts-'));
    const destination = path.join(dir, 'out.pdf');
    const input = Buffer.from('%PDF-1.4 original document body\n');

    const result = await compress(input, {
      gsModule: writeLadderGs(dir),
      targetSize: 500,
      output: destination,
    });

    expect(result.output).toBe(path.resolve(destination));
    expect(result.compressedSize).toBeLessThanOrEqual(500);
    expect(fs.statSync(destination).size).toBe(result.compressedSize);
    expect(Buffer.isBuffer(result)).toBe(false);
  });

  it('still runs a single attempt when targetSize is omitted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-ts-'));
    const input = Buffer.from('%PDF-1.4\n');

    const result = await compress(input, {
      gsModule: writeLadderGs(dir),
    });

    expect(result.compressedSize).toBe(2000);
  });

  it('keeps the best successful attempt when a later Ghostscript call fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-ts-'));
    const input = Buffer.from('%PDF-1.4 original document body\n');
    const bin = path.join(dir, 'fake-gs.js');
    const marker = path.join(dir, 'alive-previous');
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const dpiArg = args.find((arg) => arg.startsWith('-dColorImageResolution='));
if (!outArg) process.exit(1);
const outPath = outArg.slice('-sOutputFile='.length);
const dpi = Number((dpiArg || '').slice('-dColorImageResolution='.length));
const logPath = ${JSON.stringify(path.join(dir, 'attempts.log'))};
const previous = fs.existsSync(logPath)
  ? fs.readFileSync(logPath, 'utf8').split('\\n').filter(Boolean)
  : [];
fs.appendFileSync(logPath, outPath + '\\n');
if (dpi <= 50) {
  const alive = previous.filter((filePath) => fs.existsSync(filePath));
  fs.writeFileSync(${JSON.stringify(marker)}, String(alive.length));
  process.exit(1);
}
const size = dpi <= 72 ? 800 : 2000;
fs.writeFileSync(outPath, 'x'.repeat(size));
`
    );
    fs.chmodSync(bin, 0o755);

    const result = await compress(input, {
      gsModule: bin,
      targetSize: 10,
    });

    expect(result.compressedSize).toBe(800);
    expect(fs.readFileSync(marker, 'utf8')).toBe('1');
  });
});
