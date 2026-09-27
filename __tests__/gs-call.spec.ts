import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';

function tempPdf(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-gs-'));
  const pdf = path.join(dir, 'in.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  return pdf;
}

describe('Ghostscript invocation', () => {
  it('explains how to fix a missing Ghostscript binary', async () => {
    const pdf = tempPdf();
    const missing = path.join(path.dirname(pdf), 'missing-gs');

    await expect(compress(pdf, { gsModule: missing })).rejects.toThrow(
      /COMPRESS_PDF_BIN_PATH/
    );
  });

  it('stops Ghostscript when the timeout is reached', async () => {
    const pdf = tempPdf();
    const bin = path.join(path.dirname(pdf), 'sleep-gs.js');
    fs.writeFileSync(
      bin,
      '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n'
    );
    fs.chmodSync(bin, 0o755);

    await expect(
      compress(pdf, { gsModule: bin, timeout: 200 })
    ).rejects.toThrow(/timed out/i);
  }, 3000);

  it('stops Ghostscript when the abort signal fires', async () => {
    const pdf = tempPdf();
    const bin = path.join(path.dirname(pdf), 'sleep-gs.js');
    fs.writeFileSync(
      bin,
      '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n'
    );
    fs.chmodSync(bin, 0o755);
    const controller = new AbortController();

    const pending = compress(pdf, {
      gsModule: bin,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(/abort/i);
  }, 3000);

  it('passes an absolute input path so a leading dash is not a Ghostscript flag', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-dash-'));
    const pdf = path.join(dir, '-evil.pdf');
    const log = path.join(dir, 'args.txt');
    const bin = path.join(dir, 'fake-gs.js');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_GS_LOG, args.join('\\n'));
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) {
  fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4 fake\\n');
}
`
    );
    fs.chmodSync(bin, 0o755);

    const previous = process.cwd();
    process.chdir(dir);
    process.env.FAKE_GS_LOG = log;
    try {
      await compress('-evil.pdf', { gsModule: bin });
      const args = fs.readFileSync(log, 'utf8').trim().split('\n');
      const input = args[args.length - 1];
      expect(path.isAbsolute(input)).toBe(true);
      expect(input.endsWith(`${path.sep}-evil.pdf`)).toBe(true);
    } finally {
      process.chdir(previous);
      delete process.env.FAKE_GS_LOG;
    }
  });
});
