import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');

function writeFakeGs(dir: string): { bin: string; log: string } {
  const bin = path.join(dir, 'fake-gs.js');
  const log = path.join(dir, 'args.txt');
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
  return { bin, log };
}

describe('Ghostscript binary resolution', () => {
  const previousBinPath = process.env.COMPRESS_PDF_BIN_PATH;

  afterEach(() => {
    if (previousBinPath === undefined) {
      delete process.env.COMPRESS_PDF_BIN_PATH;
    } else {
      process.env.COMPRESS_PDF_BIN_PATH = previousBinPath;
    }
    vi.resetModules();
  });

  it('uses COMPRESS_PDF_BIN_PATH set after the module is imported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-bin-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin, log } = writeFakeGs(dir);
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    process.env.FAKE_GS_LOG = log;
    delete process.env.COMPRESS_PDF_BIN_PATH;

    vi.resetModules();
    const { default: compress } = await import('../src/compress');
    process.env.COMPRESS_PDF_BIN_PATH = bin;

    await compress(pdf);

    expect(fs.readFileSync(log, 'utf8')).toContain('-sDEVICE=pdfwrite');
  });

  it('imports the ESM build and resolves the binary with __dirname', async () => {
    const env = { ...process.env };
    delete env.COMPRESS_PDF_BIN_PATH;

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          const { getBinPath } = await import('./dist/index.mjs');
          const bin = getBinPath(process.platform);
          if (typeof bin !== 'string' || bin.length === 0) {
            throw new Error('getBinPath returned an empty path');
          }
          console.log(bin);
        `,
      ],
      { cwd: root, env }
    );

    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it('uses COMPRESS_PDF_BIN_PATH set after the ESM build is imported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-esm-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin, log } = writeFakeGs(dir);
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_GS_LOG: log };
    delete env.COMPRESS_PDF_BIN_PATH;

    await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          const { compress } = await import('./dist/index.mjs');
          process.env.COMPRESS_PDF_BIN_PATH = ${JSON.stringify(bin)};
          await compress(${JSON.stringify(pdf)});
        `,
      ],
      { cwd: root, env }
    );

    expect(fs.readFileSync(log, 'utf8')).toContain('-sDEVICE=pdfwrite');
  });
});
