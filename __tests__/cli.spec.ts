import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import compress from '@/compress';
import type { CompressResult } from '../src/types';

import { runCli } from '../src/cli';

vi.mock('@/compress', () => ({
  default: vi.fn(),
}));

const compressMock = vi.mocked(compress);

function stubCompressResult(bytes: Buffer): Buffer & CompressResult {
  const originalSize = 2048;
  const compressedSize = bytes.length;
  const buf = Buffer.from(bytes);
  Object.defineProperties(buf, {
    buffer: { value: buf, enumerable: false },
    originalSize: { value: originalSize, enumerable: false },
    compressedSize: { value: compressedSize, enumerable: false },
    compressionRatio: {
      value: originalSize > 0 ? compressedSize / originalSize : 0,
      enumerable: false,
    },
    duration: { value: 42, enumerable: false },
  });
  return buf as Buffer & CompressResult;
}

describe('runCli', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    compressMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints help and exits 0 when there are no arguments', async () => {
    const code = await runCli([]);
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('compress-pdf');
    expect(logs.join('\n')).toContain('--file');
  });

  it('prints help and exits 0 for --help', async () => {
    const code = await runCli(['--help']);
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('Usage:');
  });

  it('prints help and exits 0 for -h', async () => {
    const code = await runCli(['-h']);
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('compress-pdf');
  });

  it('exits 1 when --output is missing', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-in-${process.pid}.pdf`);
    fs.writeFileSync(pdf, '%PDF stub');
    try {
      const code = await runCli(['--file', pdf]);
      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('--file and --output are required');
    } finally {
      fs.unlinkSync(pdf);
    }
  });

  it('exits 1 when --file is missing', async () => {
    const code = await runCli(['--output', path.join(os.tmpdir(), 'out.pdf')]);
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--file and --output are required');
  });

  it('exits 1 when the input file does not exist', async () => {
    const missing = path.join(
      os.tmpdir(),
      `missing-${process.pid}-${Date.now()}.pdf`
    );
    const out = path.join(os.tmpdir(), `out-${process.pid}-${Date.now()}.pdf`);
    const code = await runCli(['-f', missing, '-o', out]);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes('File not found'))).toBe(true);
  });

  it('compresses and writes output on success', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-ok-${process.pid}.pdf`);
    const outp = path.join(os.tmpdir(), `compress-cli-out-${process.pid}.pdf`);
    fs.writeFileSync(pdf, '%PDF-1.4');
    compressMock.mockResolvedValue(stubCompressResult(Buffer.from('%PDF-out')));

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '-r', 'screen']);
      expect(code).toBe(0);
      expect(fs.readFileSync(outp).equals(Buffer.from('%PDF-out'))).toBe(true);
      expect(compressMock).toHaveBeenCalledWith(pdf, {
        resolution: 'screen',
        compatibilityLevel: undefined,
        imageQuality: undefined,
        gsModule: undefined,
        pdfPassword: undefined,
        removePasswordAfterCompression: false,
      });
      expect(logs.some((l) => l.includes('PDF compressed successfully'))).toBe(
        true
      );
    } finally {
      fs.unlinkSync(pdf);
      fs.unlinkSync(outp);
    }
  });

  it('maps optional flags into compress options', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-opt-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-opt-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(stubCompressResult(Buffer.from('x')));

    try {
      const code = await runCli([
        '-f',
        pdf,
        '-o',
        outp,
        '--compatibilityLevel',
        '1.4',
        '--imageQuality',
        '144',
        '--gsModule',
        '/custom/gs',
        '--pdfPassword',
        'secret',
        '--removePasswordAfterCompression',
      ]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(pdf, {
        resolution: undefined,
        compatibilityLevel: 1.4,
        imageQuality: 144,
        gsModule: '/custom/gs',
        pdfPassword: 'secret',
        removePasswordAfterCompression: true,
      });
    } finally {
      fs.unlinkSync(pdf);
      fs.unlinkSync(outp);
    }
  });

  it('exits 1 and logs when compress throws', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-fail-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-fail-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockRejectedValue(new Error('ghostscript vanished'));

    try {
      const code = await runCli(['--file', pdf, '--output', outp]);
      expect(code).toBe(1);
      expect(errors.some((e) => e.includes('ghostscript vanished'))).toBe(true);
      expect(fs.existsSync(outp)).toBe(false);
    } finally {
      fs.unlinkSync(pdf);
    }
  });
});
