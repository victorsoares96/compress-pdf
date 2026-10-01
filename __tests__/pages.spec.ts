import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';
import split from '../src/split';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pages-'));
}

function writePdf(dir: string, name: string): string {
  const pdf = path.join(dir, name);
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  return pdf;
}

function writeFakeGs(
  dir: string,
  pageCount: number,
  failOnPageList?: string
): string {
  const bin = path.join(dir, 'fake-gs.js');
  const log = path.join(dir, 'args.txt');
  const failCheck = failOnPageList
    ? `if (args.includes('-sPageList=${failOnPageList}')) { console.error('fail page'); process.exit(1); }`
    : '';
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
  ${failCheck}
}
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function writeTimedGs(
  dir: string,
  options: {
    pageCount: number;
    delayMs: number;
    delayPage?: string;
    failOnPageList?: string;
  }
): string {
  const bin = path.join(dir, 'fake-gs.js');
  const log = path.join(dir, 'args.txt');
  const failCheck = options.failOnPageList
    ? `if (page === ${JSON.stringify(options.failOnPageList)}) { console.error('fail page'); process.exit(1); }`
    : '';
  const delayPage =
    options.delayPage === undefined
      ? 'true'
      : `page === ${JSON.stringify(options.delayPage)}`;
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, args.join('\\n') + '\\n---\\n');
if (args.includes('-dPDFINFO')) {
  console.log('File has ${options.pageCount} pages');
  process.exit(0);
}
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const pageArg = args.find((arg) => arg.startsWith('-sPageList='));
const page = pageArg ? pageArg.slice('-sPageList='.length) : '';
if (outArg) {
  const stamp = path.join(${JSON.stringify(dir)}, 'stamp-' + page + '.txt');
  fs.writeFileSync(stamp, 'start ' + Date.now() + '\\n');
  if (${delayPage}) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${options.delayMs});
  }
  ${failCheck}
  fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4 fake\\n');
  fs.appendFileSync(stamp, 'end ' + Date.now() + '\\n');
}
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function readStamp(dir: string, page: string): { start: number; end: number } {
  const lines = fs
    .readFileSync(path.join(dir, `stamp-${page}.txt`), 'utf8')
    .trim()
    .split('\n');
  const start = Number(lines[0].slice('start '.length));
  const end = Number(lines[1].slice('end '.length));
  return { start, end };
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

describe('pages', () => {
  it('does not ask Ghostscript for a page list when pages is omitted', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 4);

    await compress(pdf, { gsModule: bin });

    const calls = recordedCalls(dir);
    expect(calls.some((args) => args.includes('-dPDFINFO'))).toBe(false);
    expect(
      calls.some((args) => args.some((arg) => arg.startsWith('-sPageList=')))
    ).toBe(false);
  });

  it('sends the page list on the same Ghostscript run', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 10);

    await compress(pdf, { gsModule: bin, pages: '1-3, 5' });

    const writes = recordedCalls(dir).filter((args) =>
      args.some((arg) => arg.startsWith('-sOutputFile='))
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('-sPageList=1-3,5');
    expect(writes[0][writes[0].length - 1]).toBe(path.resolve(pdf));
  });

  it('keeps a backwards range in the order it was written', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 10);

    await compress(pdf, { gsModule: bin, pages: '5-1' });

    const calls = recordedCalls(dir);
    const lists = calls
      .map((args) => args.find((arg) => arg.startsWith('-sPageList=')))
      .filter((arg): arg is string => arg !== undefined);
    expect(lists).toEqual([
      '-sPageList=5',
      '-sPageList=4',
      '-sPageList=3',
      '-sPageList=2',
      '-sPageList=1',
    ]);
    const extracts = calls.filter((args) =>
      args.some((arg) => arg.startsWith('-sPageList='))
    );
    extracts.forEach((args) => {
      expect(args.some((arg) => arg.startsWith('-dPDFSETTINGS='))).toBe(false);
      expect(args).toContain('-dPassThroughJPEGImages=true');
      expect(args).toContain('-dDownsampleColorImages=false');
      expect(args).toContain('-dEncodeColorImages=false');
    });
    const finals = calls.filter((args) =>
      args.some((arg) => arg.startsWith('-dPDFSETTINGS='))
    );
    expect(finals).toHaveLength(1);
    expect(finals[0].some((arg) => arg.startsWith('-sPageList='))).toBe(false);
  });

  it.each(['', '0', '1.5', 'even', '1-'])(
    'rejects pages value %j before Ghostscript runs',
    async (pages) => {
      const dir = tempDir();
      const pdf = writePdf(dir, 'in.pdf');
      const bin = writeFakeGs(dir, 4);

      await expect(compress(pdf, { gsModule: bin, pages })).rejects.toThrow(
        /pages must be a list like 1-3,5/
      );
      expect(recordedCalls(dir)).toHaveLength(0);
    }
  );

  it.each(['1-500000000', '500000000-1'])(
    'rejects a huge range %j from its ends before writing a PDF',
    async (pages) => {
      const dir = tempDir();
      const pdf = writePdf(dir, 'in.pdf');
      const bin = writeFakeGs(dir, 2);
      const started = Date.now();

      await expect(compress(pdf, { gsModule: bin, pages })).rejects.toThrow(
        /past the end/
      );
      expect(Date.now() - started).toBeLessThan(2000);
      const writes = recordedCalls(dir).filter((args) =>
        args.some((arg) => arg.startsWith('-sOutputFile='))
      );
      expect(writes).toHaveLength(0);
    }
  );

  it('rejects a page past the end before writing a PDF', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 2);
    const out = path.join(dir, 'out.pdf');

    await expect(
      compress(pdf, { gsModule: bin, pages: '3', output: out })
    ).rejects.toThrow(/past the end/);
    expect(fs.existsSync(out)).toBe(false);
    expect(
      recordedCalls(dir).some((args) =>
        args.some((arg) => arg.startsWith('-sOutputFile='))
      )
    ).toBe(false);
  });

  it('repeats the same page list on every targetSize attempt', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 4);

    await compress(pdf, { gsModule: bin, pages: '1-2', targetSize: 1 });

    const writes = recordedCalls(dir).filter((args) =>
      args.some((arg) => arg.startsWith('-sOutputFile='))
    );
    expect(writes.length).toBeGreaterThan(1);
    writes.forEach((args) => {
      expect(args).toContain('-sPageList=1-2');
    });
  });
});

describe('merge', () => {
  it('sends every file to one Ghostscript run, in order', async () => {
    const dir = tempDir();
    const first = writePdf(dir, 'a.pdf');
    const second = writePdf(dir, 'b.pdf');
    const bin = writeFakeGs(dir, 2);

    await compress([first, second], { gsModule: bin });

    const writes = recordedCalls(dir).filter((args) =>
      args.some((arg) => arg.startsWith('-sOutputFile='))
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].slice(-2)).toEqual([
      path.resolve(first),
      path.resolve(second),
    ]);
    expect(writes[0].some((arg) => arg.startsWith('-sPageList='))).toBe(false);
  });

  it('writes buffers to temp files and passes those paths', async () => {
    const dir = tempDir();
    const bin = writeFakeGs(dir, 2);
    const first = Buffer.from('%PDF-1.4 first\n');
    const second = Buffer.from('%PDF-1.4 second\n');

    await compress([first, second], { gsModule: bin });

    const bodies = fs.readFileSync(path.join(dir, 'bodies.txt'), 'utf8');
    expect(bodies.indexOf('%PDF-1.4 first')).toBeGreaterThanOrEqual(0);
    expect(bodies.indexOf('%PDF-1.4 first')).toBeLessThan(
      bodies.indexOf('%PDF-1.4 second')
    );
  });

  it('rejects pages, auto, and returnOriginalIfLarger for more than one file', async () => {
    const dir = tempDir();
    const first = writePdf(dir, 'a.pdf');
    const second = writePdf(dir, 'b.pdf');
    const bin = writeFakeGs(dir, 2);

    await expect(
      compress([first, second], { gsModule: bin, pages: '1' })
    ).rejects.toThrow(/pages cannot be used/);
    await expect(
      compress([first, second], { gsModule: bin, resolution: 'auto' })
    ).rejects.toThrow(/resolution auto/);
    await expect(
      compress([first, second], {
        gsModule: bin,
        returnOriginalIfLarger: true,
      })
    ).rejects.toThrow(/returnOriginalIfLarger/);
    expect(recordedCalls(dir)).toHaveLength(0);
  });

  it('rejects an empty list', async () => {
    await expect(compress([])).rejects.toThrow(/at least one PDF/);
  });
});

describe('split', () => {
  it('writes one file per source page, in the requested order', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 4);

    const result = await split(pdf, {
      gsModule: bin,
      pages: '2,1',
      concurrency: 1,
      output: path.join(dir, 'page-%d.pdf'),
    });

    expect(result.files).toEqual([
      path.join(dir, 'page-2.pdf'),
      path.join(dir, 'page-1.pdf'),
    ]);
    expect(fs.existsSync(result.files[0])).toBe(true);
    expect(fs.existsSync(result.files[1])).toBe(true);
    const lists = recordedCalls(dir)
      .filter((args) => args.some((arg) => arg.startsWith('-sOutputFile=')))
      .map((args) => args.find((arg) => arg.startsWith('-sPageList=')));
    expect(lists).toEqual(['-sPageList=2', '-sPageList=1']);
  });

  it('rejects a pattern without one %d and returnOriginalIfLarger', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 2);

    await expect(
      split(pdf, { gsModule: bin, output: path.join(dir, 'out.pdf') })
    ).rejects.toThrow(/must contain %d once/);
    await expect(
      split(pdf, {
        gsModule: bin,
        output: path.join(dir, 'page-%d-%d.pdf'),
        returnOriginalIfLarger: true,
      })
    ).rejects.toThrow(/must contain %d once/);
    await expect(
      split(pdf, {
        gsModule: bin,
        output: path.join(dir, 'page-%d.pdf'),
        returnOriginalIfLarger: true,
      })
    ).rejects.toThrow(/returnOriginalIfLarger/);
    expect(recordedCalls(dir)).toHaveLength(0);
  });

  it('rejects a repeated page before writing', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 2);

    await expect(
      split(pdf, {
        gsModule: bin,
        pages: '1,1',
        output: path.join(dir, 'page-%d.pdf'),
      })
    ).rejects.toThrow(/same page twice/);
    const writes = recordedCalls(dir).filter((args) =>
      args.some((arg) => arg.startsWith('-sOutputFile='))
    );
    expect(writes).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'page-1.pdf'))).toBe(false);
  });

  it('removes files already written when a later page fails', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 2, '2');

    await expect(
      split(pdf, {
        gsModule: bin,
        output: path.join(dir, 'page-%d.pdf'),
      })
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'page-1.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'page-2.pdf'))).toBe(false);
  });

  it('compresses pages at the same time and keeps the requested order', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeTimedGs(dir, { pageCount: 2, delayMs: 300 });

    const result = await split(pdf, {
      gsModule: bin,
      pages: '2,1',
      concurrency: 2,
      output: path.join(dir, 'page-%d.pdf'),
    });

    expect(result.files).toEqual([
      path.join(dir, 'page-2.pdf'),
      path.join(dir, 'page-1.pdf'),
    ]);
    const first = readStamp(dir, '2');
    const second = readStamp(dir, '1');
    expect(Math.max(first.start, second.start)).toBeLessThan(
      Math.min(first.end, second.end)
    );
  });

  it('runs one page at a time when concurrency is 1', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeTimedGs(dir, { pageCount: 2, delayMs: 200 });

    await split(pdf, {
      gsModule: bin,
      concurrency: 1,
      output: path.join(dir, 'page-%d.pdf'),
    });

    const first = readStamp(dir, '1');
    const second = readStamp(dir, '2');
    expect(first.end).toBeLessThanOrEqual(second.start);
  });

  it('stops the other pages when one fails and keeps that error', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeTimedGs(dir, {
      pageCount: 2,
      delayMs: 2000,
      delayPage: '1',
      failOnPageList: '2',
    });
    const started = Date.now();

    await expect(
      split(pdf, {
        gsModule: bin,
        concurrency: 2,
        output: path.join(dir, 'page-%d.pdf'),
      })
    ).rejects.toThrow(/fail page/);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(fs.existsSync(path.join(dir, 'page-1.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'page-2.pdf'))).toBe(false);
  });

  it('rejects concurrency that is not a positive integer before Ghostscript', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 2);
    const output = path.join(dir, 'page-%d.pdf');

    await expect(
      split(pdf, { gsModule: bin, output, concurrency: 0 })
    ).rejects.toThrow(/positive integer/);
    await expect(
      split(pdf, { gsModule: bin, output, concurrency: 1.5 })
    ).rejects.toThrow(/positive integer/);
    await expect(
      split(pdf, { gsModule: bin, output, concurrency: Number.NaN })
    ).rejects.toThrow(/positive integer/);
    expect(recordedCalls(dir)).toHaveLength(0);
  });

  it('rejects an aborted signal before Ghostscript', async () => {
    const dir = tempDir();
    const pdf = writePdf(dir, 'in.pdf');
    const bin = writeFakeGs(dir, 2);
    const controller = new AbortController();
    controller.abort();

    await expect(
      split(pdf, {
        gsModule: bin,
        output: path.join(dir, 'page-%d.pdf'),
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/);
    expect(recordedCalls(dir)).toHaveLength(0);
  });
});

function pdfText(gs: string, pdf: string): string {
  return execFileSync(
    gs,
    ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=txtwrite', '-sOutputFile=-', pdf],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
}

function labeledPdf(
  gs: string,
  dir: string,
  name: string,
  labels: string[]
): string {
  const ps = path.join(dir, `${name}.ps`);
  const pdf = path.join(dir, `${name}.pdf`);
  const body = labels
    .map(
      (label) =>
        `/Times-Roman findfont 20 scalefont setfont 72 500 moveto (${label}) show showpage`
    )
    .join('\n');
  fs.writeFileSync(ps, `%!PS\n${body}\n`);
  execFileSync(gs, [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-sDEVICE=pdfwrite',
    `-sOutputFile=${pdf}`,
    ps,
  ]);
  return pdf;
}

describe('pages with Ghostscript', () => {
  const gs = '/usr/bin/gs';

  it.skipIf(!fs.existsSync(gs))(
    'keeps pages in the written order and joins files',
    async () => {
      const dir = tempDir();
      const source = labeledPdf(gs, dir, 'source', [
        'PAGE_ONE',
        'PAGE_TWO',
        'PAGE_THREE',
      ]);
      const picked = path.join(dir, 'picked.pdf');
      await compress(source, { gsModule: gs, pages: '3,1', output: picked });
      const pickedText = pdfText(gs, picked);
      expect(pickedText.indexOf('PAGE_THREE')).toBeGreaterThanOrEqual(0);
      expect(pickedText.indexOf('PAGE_THREE')).toBeLessThan(
        pickedText.indexOf('PAGE_ONE')
      );
      expect(pickedText).not.toContain('PAGE_TWO');

      const missing = path.join(dir, 'missing.pdf');
      await expect(
        compress(source, { gsModule: gs, pages: '4', output: missing })
      ).rejects.toThrow(/past the end/);
      expect(fs.existsSync(missing)).toBe(false);

      const left = labeledPdf(gs, dir, 'left', ['LEFT_FILE']);
      const right = labeledPdf(gs, dir, 'right', ['RIGHT_FILE']);
      const merged = path.join(dir, 'merged.pdf');
      await compress([left, right], { gsModule: gs, output: merged });
      const mergedText = pdfText(gs, merged);
      expect(mergedText.indexOf('LEFT_FILE')).toBeLessThan(
        mergedText.indexOf('RIGHT_FILE')
      );

      const parts = await split(source, {
        gsModule: gs,
        pages: '3,1',
        output: path.join(dir, 'part-%d.pdf'),
      });
      expect(parts.files.map((filePath) => path.basename(filePath))).toEqual([
        'part-3.pdf',
        'part-1.pdf',
      ]);
      const third = pdfText(gs, parts.files[0]);
      const first = pdfText(gs, parts.files[1]);
      expect(third).toContain('PAGE_THREE');
      expect(third).not.toContain('PAGE_ONE');
      expect(first).toContain('PAGE_ONE');
      expect(first).not.toContain('PAGE_THREE');
    },
    30000
  );
});
