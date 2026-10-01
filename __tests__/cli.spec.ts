import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import compress, { compressStream } from '@/compress';
import split from '@/split';
import type { CompressFileResult } from '../src/types';

import { runCli } from '../src/cli';

vi.mock('@/compress', () => ({
  default: vi.fn(),
  compressStream: vi.fn(),
}));

vi.mock('@/split', () => ({
  default: vi.fn(),
}));

const compressMock = vi.mocked(compress);
const compressStreamMock = vi.mocked(compressStream);
const splitMock = vi.mocked(split);

function stubFileResult(
  outputPath: string,
  bytes: Buffer = Buffer.from('%PDF-out'),
  writeFile = true
): CompressFileResult {
  const originalSize = 2048;
  const compressedSize = bytes.length;
  if (writeFile) {
    fs.writeFileSync(outputPath, bytes);
  }
  return {
    originalSize,
    compressedSize,
    compressionRatio: originalSize > 0 ? compressedSize / originalSize : 0,
    duration: 42,
    output: path.resolve(outputPath),
  };
}

describe('runCli', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  const previousPassword = process.env.COMPRESS_PDF_PASSWORD;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    delete process.env.COMPRESS_PDF_PASSWORD;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    compressMock.mockReset();
    compressStreamMock.mockReset();
    splitMock.mockReset();
  });

  afterEach(() => {
    if (previousPassword === undefined) {
      delete process.env.COMPRESS_PDF_PASSWORD;
    } else {
      process.env.COMPRESS_PDF_PASSWORD = previousPassword;
    }
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
    expect(logs.join('\n')).toContain('--batch');
    expect(logs.join('\n')).toContain('COMPRESS_PDF_PASSWORD');
    expect(logs.join('\n')).toContain('shell history');
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
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('%PDF-out')) as never
    );

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
        returnOriginalIfLarger: false,
        targetSize: undefined,
        stripMetadata: false,
        sanitize: false,
        setMetadata: undefined,
        pdfa: undefined,
        output: outp,
      });
      expect(logs.some((l) => l.includes('PDF compressed successfully'))).toBe(
        true
      );
      expect(logs.some((l) => l.includes(path.resolve(outp)))).toBe(true);
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('maps optional flags into compress options', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-opt-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-opt-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x')) as never
    );

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
        '--returnOriginalIfLarger',
        '--targetSize',
        '2048',
      ]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(pdf, {
        resolution: undefined,
        compatibilityLevel: 1.4,
        imageQuality: 144,
        gsModule: '/custom/gs',
        pdfPassword: 'secret',
        removePasswordAfterCompression: true,
        returnOriginalIfLarger: true,
        targetSize: 2048,
        stripMetadata: false,
        sanitize: false,
        setMetadata: undefined,
        pdfa: undefined,
        output: outp,
      });
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('uses COMPRESS_PDF_PASSWORD when --pdfPassword is omitted', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-env-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-env-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    process.env.COMPRESS_PDF_PASSWORD = 'from-env';
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x')) as never
    );

    try {
      const code = await runCli(['-f', pdf, '-o', outp]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({ pdfPassword: 'from-env', output: outp })
      );
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('prefers --pdfPassword over COMPRESS_PDF_PASSWORD', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-both-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-both-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    process.env.COMPRESS_PDF_PASSWORD = 'from-env';
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x')) as never
    );

    try {
      const code = await runCli([
        '-f',
        pdf,
        '-o',
        outp,
        '--pdfPassword',
        'from-flag',
      ]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({ pdfPassword: 'from-flag', output: outp })
      );
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
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

  it('exits 1 and prints help when a flag is unknown', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-typo-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-typo-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '--imageQualty', '50']);
      expect(code).toBe(1);
      expect(compressMock).not.toHaveBeenCalled();
      const output = errors.join('\n');
      expect(output).toContain('imageQualty');
      expect(output).toContain('Usage:');
      expect(fs.existsSync(outp)).toBe(false);
    } finally {
      fs.unlinkSync(pdf);
    }
  });

  it('maps metadata flags into compress options', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-meta-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-meta-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli([
        '-f',
        pdf,
        '-o',
        outp,
        '--stripMetadata',
        '--sanitize',
        '--title',
        'Report',
        '--author',
        'Ada',
      ]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({
          stripMetadata: true,
          sanitize: true,
          setMetadata: { title: 'Report', author: 'Ada' },
          output: outp,
        })
      );
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('maps --pdfa into compress options', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-pdfa-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-pdfa-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '--pdfa', '3b']);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({ pdfa: '3b', output: outp })
      );
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('exits 1 before compressing when pdfa is unknown', async () => {
    const pdf = path.join(
      os.tmpdir(),
      `compress-cli-pdfa-bad-${process.pid}.pdf`
    );
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-pdfa-bad-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '--pdfa', '1a']);
      expect(code).toBe(1);
      expect(compressMock).not.toHaveBeenCalled();
      expect(errors.join('\n')).toContain('Invalid pdfa');
      expect(fs.existsSync(outp)).toBe(false);
    } finally {
      fs.unlinkSync(pdf);
    }
  });

  it('accepts resolution auto and passes it to compress', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-auto-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-auto-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '-r', 'auto']);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({ resolution: 'auto', output: outp })
      );
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('exits 1 before compressing when the resolution preset is unknown', async () => {
    const pdf = path.join(
      os.tmpdir(),
      `compress-cli-preset-${process.pid}.pdf`
    );
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-preset-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '-r', 'print']);
      expect(code).toBe(1);
      expect(compressMock).not.toHaveBeenCalled();
      expect(errors.join('\n')).toContain('Invalid resolution "print"');
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('maps --pages into compress options', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-pages-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-pages-out-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '--pages', '1-3,5']);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({ pages: '1-3,5', output: outp })
      );
      expect(splitMock).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('joins repeated --file arguments in order', async () => {
    const first = path.join(os.tmpdir(), `compress-cli-a-${process.pid}.pdf`);
    const second = path.join(os.tmpdir(), `compress-cli-b-${process.pid}.pdf`);
    const outp = path.join(os.tmpdir(), `compress-cli-join-${process.pid}.pdf`);
    fs.writeFileSync(first, '%PDF');
    fs.writeFileSync(second, '%PDF');
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );

    try {
      const code = await runCli(['-f', first, '-f', second, '-o', outp]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        [first, second],
        expect.any(Object)
      );
    } finally {
      fs.unlinkSync(first);
      fs.unlinkSync(second);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('splits when the output path contains %d', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-split-${process.pid}.pdf`);
    const outp = path.join(os.tmpdir(), `page-%d-${process.pid}.pdf`);
    fs.writeFileSync(pdf, '%PDF');
    const written = path.resolve(outp.replace('%d', '1'));
    splitMock.mockResolvedValue({ files: [written], duration: 5 });

    try {
      const code = await runCli(['-f', pdf, '-o', outp, '--pages', '1']);
      expect(code).toBe(0);
      expect(splitMock).toHaveBeenCalledWith(
        pdf,
        expect.objectContaining({ pages: '1', output: outp })
      );
      expect(compressMock).not.toHaveBeenCalled();
      expect(logs.join('\n')).toContain('PDF split successfully');
    } finally {
      fs.unlinkSync(pdf);
    }
  });

  it('exits 1 before compressing when pages or split flags disagree', async () => {
    const first = path.join(
      os.tmpdir(),
      `compress-cli-bad-a-${process.pid}.pdf`
    );
    const second = path.join(
      os.tmpdir(),
      `compress-cli-bad-b-${process.pid}.pdf`
    );
    fs.writeFileSync(first, '%PDF');
    fs.writeFileSync(second, '%PDF');
    const outp = path.join(os.tmpdir(), `compress-cli-bad-${process.pid}.pdf`);

    try {
      const pagesCode = await runCli(['-f', first, '-o', outp, '--pages', '0']);
      expect(pagesCode).toBe(1);
      expect(errors.join('\n')).toContain('pages must be a list');

      errors.length = 0;
      const manyCode = await runCli([
        '-f',
        first,
        '-f',
        second,
        '-o',
        outp,
        '--pages',
        '1',
      ]);
      expect(manyCode).toBe(1);
      expect(errors.join('\n')).toContain('more than one PDF');

      errors.length = 0;
      const splitCode = await runCli([
        '-f',
        first,
        '-f',
        second,
        '-o',
        'page-%d.pdf',
      ]);
      expect(splitCode).toBe(1);
      expect(errors.join('\n')).toContain('%d');

      errors.length = 0;
      const twiceCode = await runCli(['-f', first, '-o', 'page-%d-%d.pdf']);
      expect(twiceCode).toBe(1);
      expect(errors.join('\n')).toContain('%d once');

      errors.length = 0;
      const keepCode = await runCli([
        '-f',
        first,
        '-o',
        'page-%d.pdf',
        '--returnOriginalIfLarger',
      ]);
      expect(keepCode).toBe(1);
      expect(errors.join('\n')).toContain('returnOriginalIfLarger');
      expect(compressMock).not.toHaveBeenCalled();
      expect(splitMock).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(first);
      fs.unlinkSync(second);
    }
  });

  it('reads stdin and writes the PDF to stdout', async () => {
    const pdf = path.join(os.tmpdir(), `compress-cli-stdin-${process.pid}.pdf`);
    const outp = path.join(
      os.tmpdir(),
      `compress-cli-stdout-${process.pid}.pdf`
    );
    fs.writeFileSync(pdf, '%PDF');
    const bytes = Buffer.from('%PDF-out');
    compressStreamMock.mockResolvedValue(
      Object.assign(Readable.from(bytes), {
        originalSize: 2048,
        compressedSize: bytes.length,
        compressionRatio: bytes.length / 2048,
        duration: 42,
      }) as never
    );
    compressMock.mockResolvedValue(
      stubFileResult(outp, Buffer.from('x'), false) as never
    );
    const written: Buffer[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(
        (chunk: unknown, encoding?: unknown, cb?: unknown) => {
          const callback = typeof encoding === 'function' ? encoding : cb;
          if (Buffer.isBuffer(chunk) || typeof chunk === 'string') {
            written.push(Buffer.from(chunk));
          }
          if (typeof callback === 'function') callback();
          return true;
        }
      );

    try {
      const stdinCode = await runCli(['-f', '-', '-o', outp]);
      expect(stdinCode).toBe(0);
      expect(compressMock).toHaveBeenCalledWith(
        process.stdin,
        expect.objectContaining({ output: outp })
      );

      compressMock.mockClear();
      errors.length = 0;
      const stdoutCode = await runCli(['-f', pdf, '-o', '-']);
      expect(stdoutCode).toBe(0);
      expect(compressStreamMock).toHaveBeenCalledWith(
        pdf,
        expect.not.objectContaining({ output: expect.anything() })
      );
      expect(Buffer.concat(written).equals(bytes)).toBe(true);
      expect(errors.join('\n')).toContain('PDF compressed successfully');
      expect(logs.join('\n')).not.toContain('%PDF-out');
      expect(splitMock).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      fs.unlinkSync(pdf);
      if (fs.existsSync(outp)) fs.unlinkSync(outp);
    }
  });

  it('rejects a second stdin before compressing', async () => {
    const code = await runCli(['-f', '-', '-f', '-', '-o', 'out.pdf']);
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('stdin can only be read once');
    expect(compressMock).not.toHaveBeenCalled();
    expect(compressStreamMock).not.toHaveBeenCalled();
    expect(splitMock).not.toHaveBeenCalled();
  });

  it('compresses each PDF in a folder without joining them', async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-batch-in-'));
    const outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'compress-batch-out-')
    );
    fs.writeFileSync(path.join(source, 'b.pdf'), '%PDF-b');
    fs.writeFileSync(path.join(source, 'a.PDF'), '%PDF-a');
    fs.writeFileSync(path.join(source, 'notes.txt'), 'nope');
    fs.mkdirSync(path.join(source, 'nested'));
    fs.writeFileSync(path.join(source, 'nested', 'c.pdf'), '%PDF-c');
    fs.mkdirSync(path.join(source, 'fake.pdf'));
    compressMock.mockImplementation(async (file, options) => {
      const outputPath = (options as { output?: string }).output;
      if (outputPath === undefined) {
        throw new Error('missing output');
      }
      return stubFileResult(
        outputPath,
        Buffer.from(`out-${path.basename(String(file))}`)
      ) as never;
    });

    try {
      const code = await runCli([
        '--batch',
        source,
        '-o',
        outDir,
        '-r',
        'ebook',
      ]);
      expect(code).toBe(0);
      expect(compressMock).toHaveBeenCalledTimes(2);
      expect(compressMock).toHaveBeenNthCalledWith(
        1,
        path.join(source, 'a.PDF'),
        expect.objectContaining({
          resolution: 'ebook',
          output: path.join(outDir, 'a.PDF'),
        })
      );
      expect(compressMock).toHaveBeenNthCalledWith(
        2,
        path.join(source, 'b.pdf'),
        expect.objectContaining({
          output: path.join(outDir, 'b.pdf'),
        })
      );
      expect(fs.readFileSync(path.join(outDir, 'a.PDF')).toString()).toBe(
        'out-a.PDF'
      );
      expect(logs.join('\n')).toContain('a.PDF');
      expect(logs.join('\n')).toContain('b.pdf');
      expect(splitMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('creates the batch output directory and keeps going after one failure', async () => {
    const source = fs.mkdtempSync(
      path.join(os.tmpdir(), 'compress-batch-keep-')
    );
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), 'compress-batch-parent-')
    );
    const outDir = path.join(parent, 'out');
    fs.writeFileSync(path.join(source, 'a.pdf'), '%PDF-a');
    fs.writeFileSync(path.join(source, 'bad.pdf'), '%PDF-bad');
    fs.writeFileSync(path.join(source, 'c.pdf'), '%PDF-c');
    compressMock.mockImplementation(async (file, options) => {
      const name = path.basename(String(file));
      if (name === 'bad.pdf') {
        throw new Error('ghostscript vanished');
      }
      const outputPath = (options as { output?: string }).output;
      if (outputPath === undefined) {
        throw new Error('missing output');
      }
      return stubFileResult(outputPath, Buffer.from('ok')) as never;
    });

    try {
      const code = await runCli([
        '--batch',
        source,
        '-o',
        outDir,
        '-r',
        'auto',
        '--pages',
        '1-2',
        '--returnOriginalIfLarger',
      ]);
      expect(code).toBe(1);
      expect(fs.statSync(outDir).isDirectory()).toBe(true);
      expect(compressMock).toHaveBeenCalledTimes(3);
      expect(compressMock).toHaveBeenNthCalledWith(
        1,
        path.join(source, 'a.pdf'),
        expect.objectContaining({
          resolution: 'auto',
          pages: '1-2',
          returnOriginalIfLarger: true,
          output: path.join(outDir, 'a.pdf'),
        })
      );
      expect(compressMock).toHaveBeenNthCalledWith(
        3,
        path.join(source, 'c.pdf'),
        expect.objectContaining({
          output: path.join(outDir, 'c.pdf'),
        })
      );
      expect(fs.existsSync(path.join(outDir, 'a.pdf'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'c.pdf'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'bad.pdf'))).toBe(false);
      expect(errors.join('\n')).toContain('bad.pdf');
      expect(errors.join('\n')).toContain('ghostscript vanished');
      expect(logs.join('\n')).toContain('a.pdf');
      expect(logs.join('\n')).toContain('c.pdf');
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects a batch that would join, split, or overwrite', async () => {
    const source = fs.mkdtempSync(
      path.join(os.tmpdir(), 'compress-batch-reject-')
    );
    const outDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'compress-batch-reject-out-')
    );
    const empty = fs.mkdtempSync(
      path.join(os.tmpdir(), 'compress-batch-empty-')
    );
    const pdf = path.join(source, 'a.pdf');
    const fileOut = path.join(outDir, 'file.pdf');
    fs.writeFileSync(pdf, '%PDF');
    fs.writeFileSync(fileOut, 'x');
    fs.writeFileSync(path.join(empty, 'notes.txt'), 'nope');

    const cases: { args: string[]; text: string }[] = [
      {
        args: ['--batch', source, '-f', pdf, '-o', outDir],
        text: '--file',
      },
      {
        args: ['--batch', source],
        text: '--output is required',
      },
      {
        args: ['--batch', source, '-o', '-'],
        text: 'stdout',
      },
      {
        args: ['--batch', source, '-o', path.join(outDir, 'page-%d.pdf')],
        text: '%d',
      },
      {
        args: ['--batch', source, '-o', fileOut],
        text: '--output must be a directory',
      },
      {
        args: ['--batch', source, '-o', source],
        text: 'different directory',
      },
      {
        args: ['--batch', empty, '-o', outDir],
        text: 'no PDF',
      },
      {
        args: ['--batch', pdf, '-o', outDir],
        text: '--batch must be a directory',
      },
      {
        args: ['--batch', source, '-o', outDir, '--pages', '0'],
        text: 'pages must be a list',
      },
      {
        args: ['--batch', source, '-o', outDir, '-r', 'print'],
        text: 'Invalid resolution',
      },
    ];

    try {
      await cases.reduce(async (previous, item) => {
        await previous;
        errors.length = 0;
        compressMock.mockClear();
        const code = await runCli(item.args);
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain(item.text);
        expect(compressMock).not.toHaveBeenCalled();
      }, Promise.resolve());
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
