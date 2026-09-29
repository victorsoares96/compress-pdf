import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import analyze from '../src/analyze';
import compress from '../src/compress';
import { inspectPdfImages } from '../src/pdf-images';
import { CompressPdfError } from '../src/types';

function makePdf(objects: { id: number; body: Buffer }[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets = new Map<number, number>();
  let used = chunks[0].length;
  objects.forEach((object) => {
    offsets.set(object.id, used);
    const head = Buffer.from(`${object.id} 0 obj\n`);
    const tail = Buffer.from('\nendobj\n');
    chunks.push(head, object.body, tail);
    used += head.length + object.body.length + tail.length;
  });

  const maxId = objects.reduce((highest, object) => {
    return object.id > highest ? object.id : highest;
  }, 0);
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  let id = 1;
  while (id <= maxId) {
    const offset = offsets.get(id);
    xref +=
      offset === undefined
        ? '0000000000 65535 f \n'
        : `${String(offset).padStart(10, '0')} 00000 n \n`;
    id += 1;
  }
  xref += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${used}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

function streamObject(dictWithoutLength: string, data: Buffer): Buffer {
  const dict = `<< ${dictWithoutLength} /Length ${data.length} >>\nstream\n`;
  return Buffer.concat([Buffer.from(dict), data, Buffer.from('\nendstream')]);
}

function xobjectPdf(): Buffer {
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const content = Buffer.from('q\n72 0 0 72 0 0 cm\n/Im0 Do\nQ\n');
  return makePdf([
    { id: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') },
    { id: 2, body: Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>') },
    {
      id: 3,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 144] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'
      ),
    },
    {
      id: 4,
      body: streamObject(
        '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8',
        pixels
      ),
    },
    { id: 5, body: streamObject('', content) },
  ]);
}

function inlineImagePdf(): Buffer {
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const content = Buffer.concat([
    Buffer.from(
      'q\n0.1 0 0 0.1 0 0 cm\nq\n10 0 0 10 0 0 cm\nBI\n/CS /RGB /W 2 /H 2 /BPC 8\nID '
    ),
    pixels,
    Buffer.from('\nEI\nQ\nQ\n'),
  ]);
  return makePdf([
    { id: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') },
    { id: 2, body: Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>') },
    {
      id: 3,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 144] /Contents 4 0 R >>'
      ),
    },
    { id: 4, body: streamObject('', content) },
  ]);
}

function writeReportGs(dir: string, report: string): string {
  const bin = path.join(dir, 'fake-gs.js');
  const presetLog = path.join(dir, 'presets.txt');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('-dPDFINFO')) {
  process.stdout.write(${JSON.stringify(report)});
  process.exit(0);
}
if (args.some((arg) => arg.includes('/auto'))) process.exit(3);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const presetArg = args.find((arg) => arg.startsWith('-dPDFSETTINGS='));
if (!outArg || !presetArg) process.exit(1);
const preset = presetArg.slice('-dPDFSETTINGS=/'.length);
fs.appendFileSync(${JSON.stringify(presetLog)}, preset + '\\n');
fs.writeFileSync(outArg.slice('-sOutputFile='.length), 'compressed-pdf');
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function presets(dir: string): string[] {
  const file = path.join(dir, 'presets.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n');
}

describe('analyze', () => {
  it('rejects a missing file', async () => {
    await expect(
      analyze(path.join(os.tmpdir(), `missing-${process.pid}.pdf`))
    ).rejects.toBeInstanceOf(CompressPdfError);
  });

  it('classifies a scanned PDF from the Ghostscript report', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-an-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    const info = await analyze(pdf, {
      gsModule: writeReportGs(
        dir,
        'pages=4\nimages=40\nfonts=3\nmaxImageDpi=300\n'
      ),
    });
    expect(info).toEqual({
      pages: 4,
      images: 40,
      fonts: 3,
      maxImageDpi: 300,
      kind: 'scanned',
      estimatedGain: 0.6,
    });
  });

  it('classifies vector and mixed PDFs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-an-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    const vector = await analyze(pdf, {
      gsModule: writeReportGs(
        dir,
        'pages=2\nimages=0\nfonts=5\nmaxImageDpi=null\n'
      ),
    });
    expect(vector.kind).toBe('vector');
    expect(vector.estimatedGain).toBe(0.1);
    expect(vector.maxImageDpi).toBeNull();

    const mixed = await analyze(pdf, {
      gsModule: writeReportGs(
        dir,
        'pages=1\nimages=2\nfonts=4\nmaxImageDpi=150\n'
      ),
    });
    expect(mixed.kind).toBe('mixed');
    expect(mixed.estimatedGain).toBe(0.3);
  });

  it('counts a placed image and an inline image', () => {
    expect(inspectPdfImages(xobjectPdf())).toEqual({
      images: 1,
      maxImageDpi: 2,
    });
    expect(inspectPdfImages(inlineImagePdf())).toEqual({
      images: 1,
      maxImageDpi: 144,
    });
  });

  it('maps resolution auto to a real preset and never sends auto', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-an-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 scanned\n');
    const gs = writeReportGs(
      dir,
      'pages=1\nimages=8\nfonts=0\nmaxImageDpi=200\n'
    );

    const scanned = await compress(pdf, { gsModule: gs, resolution: 'auto' });
    expect(scanned.length).toBeGreaterThan(0);
    expect(presets(dir)).toEqual(['screen']);

    fs.writeFileSync(path.join(dir, 'presets.txt'), '');
    await compress(pdf, {
      gsModule: writeReportGs(
        dir,
        'pages=1\nimages=0\nfonts=2\nmaxImageDpi=null\n'
      ),
      resolution: 'auto',
    });
    expect(presets(dir)).toEqual(['printer']);

    fs.writeFileSync(path.join(dir, 'presets.txt'), '');
    await compress(pdf, {
      gsModule: writeReportGs(
        dir,
        'pages=1\nimages=2\nfonts=4\nmaxImageDpi=72\n'
      ),
      resolution: 'auto',
    });
    expect(presets(dir)).toEqual(['ebook']);
  });

  it('keeps ebook when resolution is omitted and does not inspect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-an-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    const bin = path.join(dir, 'fake-gs.js');
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('-dPDFINFO')) process.exit(2);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const presetArg = args.find((arg) => arg.startsWith('-dPDFSETTINGS='));
if (!outArg || !presetArg) process.exit(1);
fs.writeFileSync(${JSON.stringify(path.join(dir, 'preset.txt'))}, presetArg);
fs.writeFileSync(outArg.slice('-sOutputFile='.length), 'compressed-pdf');
`
    );
    fs.chmodSync(bin, 0o755);

    await compress(pdf, { gsModule: bin });
    expect(fs.readFileSync(path.join(dir, 'preset.txt'), 'utf8')).toBe(
      '-dPDFSETTINGS=/ebook'
    );
  });

  it('starts the targetSize search from the preset auto chose', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-an-'));
    const pdf = path.join(dir, 'in.pdf');
    const presetLog = path.join(dir, 'presets.txt');
    fs.writeFileSync(pdf, '%PDF-1.4 scanned\n');
    const bin = path.join(dir, 'fake-gs.js');
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('-dPDFINFO')) {
  process.stdout.write('pages=1\\nimages=8\\nfonts=0\\nmaxImageDpi=200\\n');
  process.exit(0);
}
if (args.some((arg) => arg.includes('/auto'))) process.exit(3);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
const dpiArg = args.find((arg) => arg.startsWith('-dColorImageResolution='));
const presetArg = args.find((arg) => arg.startsWith('-dPDFSETTINGS='));
if (!outArg || !dpiArg || !presetArg) process.exit(1);
const dpi = Number(dpiArg.slice('-dColorImageResolution='.length));
const preset = presetArg.slice('-dPDFSETTINGS=/'.length);
let size = 2000;
if (dpi <= 72) size = 800;
if (dpi <= 50) size = 400;
if (preset === 'screen') size = Math.min(size, 300);
if (preset === 'screen' && dpi <= 50) size = 150;
fs.appendFileSync(${JSON.stringify(presetLog)}, preset + '\\n');
fs.writeFileSync(outArg.slice('-sOutputFile='.length), 'x'.repeat(size));
`
    );
    fs.chmodSync(bin, 0o755);

    const result = await compress(pdf, {
      gsModule: bin,
      resolution: 'auto',
      targetSize: 500,
    });

    expect(result.compressedSize).toBe(300);
    expect(presets(dir)[0]).toBe('screen');
  });
});

describe('analyze with Ghostscript', () => {
  const gs = '/usr/bin/gs';
  const hasGs = fs.existsSync(gs);

  it.skipIf(!hasGs)(
    'reads pages, fonts, and image DPI from a real file',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-an-'));
      const scanned = path.join(dir, 'scanned.pdf');
      const vector = path.join(dir, 'vector.pdf');
      fs.writeFileSync(scanned, xobjectPdf());
      fs.writeFileSync(
        vector,
        makePdf([
          { id: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') },
          {
            id: 2,
            body: Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
          },
          {
            id: 3,
            body: Buffer.from(
              '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
            ),
          },
          {
            id: 4,
            body: streamObject(
              '',
              Buffer.from('BT /F1 24 Tf 72 100 Td (Hello) Tj ET')
            ),
          },
          {
            id: 5,
            body: Buffer.from(
              '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
            ),
          },
        ])
      );

      const scannedInfo = await analyze(scanned, { gsModule: gs });
      expect(scannedInfo.pages).toBe(1);
      expect(scannedInfo.images).toBe(1);
      expect(scannedInfo.maxImageDpi).toBe(2);
      expect(scannedInfo.fonts).toBe(0);
      expect(scannedInfo.kind).toBe('scanned');

      const inline = await analyze(inlineImagePdf(), { gsModule: gs });
      expect(inline.images).toBe(1);
      expect(inline.maxImageDpi).toBe(144);
      expect(inline.kind).toBe('scanned');

      const vectorInfo = await analyze(vector, { gsModule: gs });
      expect(vectorInfo.pages).toBe(1);
      expect(vectorInfo.images).toBe(0);
      expect(vectorInfo.fonts).toBeGreaterThanOrEqual(1);
      expect(vectorInfo.kind).toBe('vector');
      expect(vectorInfo.maxImageDpi).toBeNull();
    },
    30000
  );

  it.skipIf(
    !hasGs ||
      !fs.existsSync(path.resolve(__dirname, '../examples/A17_FlightPlan.pdf'))
  )(
    'calls a scanned flight plan scanned',
    async () => {
      const info = await analyze(
        path.resolve(__dirname, '../examples/A17_FlightPlan.pdf'),
        { gsModule: gs }
      );
      expect(info.pages).toBe(618);
      expect(info.images).toBeGreaterThanOrEqual(600);
      expect(info.maxImageDpi).toBe(300);
      expect(info.fonts).toBeLessThanOrEqual(2);
      expect(info.kind).toBe('scanned');
      expect(info.estimatedGain).toBe(0.6);
    },
    60000
  );
});
