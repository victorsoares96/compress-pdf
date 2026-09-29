import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';
import { CompressPdfError } from '../src/types';

function writeRecordingGs(dir: string): string {
  const bin = path.join(dir, 'fake-gs.js');
  const argsLog = path.join(dir, 'args.json');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(${JSON.stringify(argsLog)})
  ? JSON.parse(fs.readFileSync(${JSON.stringify(argsLog)}, 'utf8'))
  : [];
previous.push(args);
fs.writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(previous));
if (args.includes('-dPDFINFO')) process.exit(0);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
if (!outArg) process.exit(1);
fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4\\n%fake\\n');
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

function recordedArgs(dir: string): string[][] {
  return JSON.parse(
    fs.readFileSync(path.join(dir, 'args.json'), 'utf8')
  ) as string[][];
}

function docinfo(args: string[]): string {
  const index = args.indexOf('-c');
  return index >= 0 ? args[index + 1] : '';
}

describe('document metadata', () => {
  it('leaves document info alone when the options are omitted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: writeRecordingGs(dir) });

    expect(recordedArgs(dir)[0].includes('-c')).toBe(false);
  });

  it('clears title, author, subject, keywords, and creator', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      stripMetadata: true,
    });

    const args = recordedArgs(dir)[0];
    const program = docinfo(args);
    expect(args.indexOf('-f')).toBeLessThan(args.indexOf('-c'));
    expect(args[args.indexOf('-f') + 1]).toBe(path.resolve(pdf));
    expect(program).toBe(
      '[ /Title () /Author () /Subject () /Keywords () /Creator () /DOCINFO pdfmark'
    );
  });

  it('writes only the metadata fields that were passed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      setMetadata: { title: 'Hello (world)', keywords: 'a\\b' },
    });

    const program = docinfo(recordedArgs(dir)[0]);
    expect(program).toBe(
      '[ /Title (Hello \\(world\\)) /Keywords (a\\\\b) /DOCINFO pdfmark'
    );
    expect(program).not.toContain('/Author');
    expect(program).not.toContain('/Creator');
  });

  it('keeps fields you set and clears the rest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      stripMetadata: true,
      setMetadata: { title: 'Report', author: 'Ada' },
    });

    expect(docinfo(recordedArgs(dir)[0])).toBe(
      '[ /Title (Report) /Author (Ada) /Subject () /Keywords () /Creator () /DOCINFO pdfmark'
    );
  });

  it('sanitize clears document info without a separate stripMetadata', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: writeRecordingGs(dir), sanitize: true });

    expect(docinfo(recordedArgs(dir)[0])).toBe(
      '[ /Title () /Author () /Subject () /Keywords () /Creator () /DOCINFO pdfmark'
    );
  });

  it('encodes non-ascii metadata as UTF-16', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      setMetadata: { title: 'São' },
    });

    expect(docinfo(recordedArgs(dir)[0])).toContain(
      '/Title <FEFF005300E3006F>'
    );
  });

  it('rejects a non-string metadata value before Ghostscript runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    const called = path.join(dir, 'called');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    const bin = path.join(dir, 'fake-gs.js');
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(called)}, '1');\n`
    );
    fs.chmodSync(bin, 0o755);

    await expect(
      compress(pdf, {
        gsModule: bin,
        setMetadata: { title: 1 as unknown as string },
      })
    ).rejects.toBeInstanceOf(CompressPdfError);
    expect(fs.existsSync(called)).toBe(false);
  });

  it('sends the same metadata program on every targetSize attempt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 original\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      stripMetadata: true,
      targetSize: 10,
    });

    const calls = recordedArgs(dir);
    expect(calls.length).toBeGreaterThan(1);
    calls.forEach((args) => {
      expect(docinfo(args)).toContain('/DOCINFO pdfmark');
      expect(docinfo(args)).toContain('/Author ()');
    });
  });
});

function pdfWithInfo(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 44 >>\nstream\nBT /F1 12 Tf 10 10 Td (Hi) Tj ET\nendstream',
    '<< /Title (Secret Title) /Author (Secret Author) /Subject (Secret Subject) /Keywords (secret) /Creator (Secret Creator) >>',
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let used = chunks[0].length;
  objects.forEach((body, index) => {
    offsets[index] = used;
    const head = Buffer.from(`${index + 1} 0 obj\n`);
    const tail = Buffer.from('\nendobj\n');
    const content = Buffer.from(body);
    chunks.push(head, content, tail);
    used += head.length + content.length + tail.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${used}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

describe('document metadata with Ghostscript', () => {
  const gs = '/usr/bin/gs';

  it.skipIf(!fs.existsSync(gs))(
    'clears the original author and can set a new title',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-md-'));
      const input = path.join(dir, 'in.pdf');
      const stripped = path.join(dir, 'stripped.pdf');
      const titled = path.join(dir, 'titled.pdf');
      fs.writeFileSync(input, pdfWithInfo());

      await compress(input, {
        gsModule: gs,
        output: stripped,
        sanitize: true,
      });
      await compress(input, {
        gsModule: gs,
        output: titled,
        setMetadata: { title: 'Only Title' },
      });

      const strippedText = fs.readFileSync(stripped).toString('latin1');
      expect(strippedText).not.toContain('Secret Author');
      expect(strippedText).not.toContain('Secret Title');

      const titledText = fs.readFileSync(titled).toString('latin1');
      expect(titledText).toContain('Only Title');
      expect(titledText).toContain('Secret Author');
    },
    30000
  );
});
