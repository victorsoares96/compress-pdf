import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';
import { CompressPdfError, type PdfaLevel } from '../src/types';

function layout(
  dir: string,
  version = '10.0.0',
  place: 'share' | 'parent' = 'share'
): { bin: string; icc: string } {
  const bin = path.join(dir, 'bin', 'fake-gs.js');
  const icc =
    place === 'parent'
      ? path.join(dir, 'iccprofiles', 'default_rgb.icc')
      : path.join(
          dir,
          'share',
          'ghostscript',
          version,
          'iccprofiles',
          'default_rgb.icc'
        );
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.mkdirSync(path.dirname(icc), { recursive: true });
  fs.writeFileSync(icc, 'icc');
  const argsLog = path.join(dir, 'args.json');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const ps = args.find((arg) => arg.endsWith('.ps'));
const previous = fs.existsSync(${JSON.stringify(argsLog)})
  ? JSON.parse(fs.readFileSync(${JSON.stringify(argsLog)}, 'utf8'))
  : [];
previous.push({
  args,
  definition: ps && fs.existsSync(ps) ? fs.readFileSync(ps, 'utf8') : '',
});
fs.writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(previous));
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4\\n%fake\\n');
`
  );
  fs.chmodSync(bin, 0o755);
  return { bin, icc };
}

function recorded(dir: string): { args: string[]; definition: string }[] {
  return JSON.parse(fs.readFileSync(path.join(dir, 'args.json'), 'utf8')) as {
    args: string[];
    definition: string;
  }[];
}

describe('pdfa', () => {
  it('asks Ghostscript for PDF/A-1b and passes the definition file before the input', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin, icc } = layout(dir);
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: bin, pdfa: '1b' });

    const { args, definition } = recorded(dir)[0];
    const inputAt = args.indexOf(path.resolve(pdf));
    const definitionAt = args.findIndex((arg) => arg.endsWith('.ps'));
    expect(args).toContain('-dPDFA=1');
    expect(args).toContain('-sColorConversionStrategy=RGB');
    expect(args).toContain('-dPDFACompatibilityPolicy=1');
    expect(args).not.toContain('-sBlendConversionStrategy=Simple');
    expect(args).toContain('-dCompatibilityLevel=1.4');
    expect(definitionAt).toBeGreaterThan(-1);
    expect(definitionAt).toBeLessThan(inputAt);
    expect(definition).toContain(icc);
    expect(definition).toContain('/GTS_PDFA1');
    expect(fs.existsSync(args[definitionAt])).toBe(false);
  });

  it('does not send PDF/A flags when the option is omitted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin } = layout(dir);
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: bin });

    const { args } = recorded(dir)[0];
    expect(args.some((arg) => arg.startsWith('-dPDFA='))).toBe(false);
    expect(args.some((arg) => arg.endsWith('.ps'))).toBe(false);
  });

  it('uses PDF 1.7 and blend conversion for PDF/A-2b and 3b', async () => {
    const levels: PdfaLevel[] = ['2b', '3b'];
    const expectations = ['-dPDFA=2', '-dPDFA=3'];

    await Promise.all(
      levels.map(async (level, index) => {
        const dir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'compress-pdf-pdfa-')
        );
        const pdf = path.join(dir, 'in.pdf');
        const { bin } = layout(dir);
        fs.writeFileSync(pdf, '%PDF-1.4\n');

        await compress(pdf, { gsModule: bin, pdfa: level });

        const { args } = recorded(dir)[0];
        expect(args).toContain(expectations[index]);
        expect(args).toContain('-sBlendConversionStrategy=Simple');
        expect(args).toContain('-dCompatibilityLevel=1.7');
      })
    );
  });

  it('rejects a compatibility level that does not match the PDF/A version', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const called = path.join(dir, 'called');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    fs.writeFileSync(
      path.join(dir, 'fake-gs.js'),
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(called)}, '1');\n`
    );
    fs.chmodSync(path.join(dir, 'fake-gs.js'), 0o755);

    await expect(
      compress(pdf, {
        gsModule: path.join(dir, 'fake-gs.js'),
        pdfa: '2b',
        compatibilityLevel: 1.4,
      })
    ).rejects.toThrow(/compatibilityLevel must be 1.7/);
    expect(fs.existsSync(called)).toBe(false);
  });

  it('rejects an unknown pdfa value before Ghostscript runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
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
      compress(pdf, { gsModule: bin, pdfa: '1a' as PdfaLevel })
    ).rejects.toBeInstanceOf(CompressPdfError);
    expect(fs.existsSync(called)).toBe(false);
  });

  it('rejects a Ghostscript install that has no default_rgb.icc', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const called = path.join(dir, 'called');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    const bin = path.join(dir, 'bin', 'fake-gs.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(called)}, '1');\n`
    );
    fs.chmodSync(bin, 0o755);

    await expect(compress(pdf, { gsModule: bin, pdfa: '1b' })).rejects.toThrow(
      /default_rgb\.icc/
    );
    expect(fs.existsSync(called)).toBe(false);
  });

  it('uses the profile beside the Ghostscript bin folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin, icc } = layout(dir, '10.0.0', 'parent');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: bin, pdfa: '1b' });

    expect(recorded(dir)[0].definition).toContain(icc);
  });

  it('picks the newest Ghostscript profile when more than one is installed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin, icc } = layout(dir, '10.2.1');
    const older = path.join(
      dir,
      'share',
      'ghostscript',
      '9.56.1',
      'iccprofiles',
      'default_rgb.icc'
    );
    fs.mkdirSync(path.dirname(older), { recursive: true });
    fs.writeFileSync(older, 'old');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: bin, pdfa: '1b' });

    const { definition } = recorded(dir)[0];
    expect(definition).toContain(icc);
    expect(definition).not.toContain(older);
  });

  it('escapes parentheses in the ICC profile path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin, icc } = layout(dir, '1.0 (copy)');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: bin, pdfa: '1b' });

    const { definition } = recorded(dir)[0];
    expect(definition).toContain(
      icc.replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    );
    expect(definition).not.toContain(icc);
  });

  it('still clears document info in the same pass', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin } = layout(dir);
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, {
      gsModule: bin,
      pdfa: '1b',
      stripMetadata: true,
    });

    const { args } = recorded(dir)[0];
    const definitionAt = args.findIndex((arg) => arg.endsWith('.ps'));
    const inputFlag = args.indexOf('-f');
    const programAt = args.indexOf('-c');
    expect(definitionAt).toBeLessThan(inputFlag);
    expect(programAt).toBeGreaterThan(inputFlag);
    expect(args[programAt + 1]).toContain('/Author ()');
  });

  it('sends PDF/A flags on every targetSize attempt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
    const pdf = path.join(dir, 'in.pdf');
    const { bin } = layout(dir);
    fs.writeFileSync(pdf, '%PDF-1.4 original\n');

    await compress(pdf, { gsModule: bin, pdfa: '1b', targetSize: 10 });

    const calls = recorded(dir);
    expect(calls.length).toBeGreaterThan(1);
    calls.forEach(({ args }) => {
      expect(args).toContain('-dPDFA=1');
      expect(args.some((arg) => arg.endsWith('.ps'))).toBe(true);
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

describe('pdfa with Ghostscript', () => {
  const gs = '/usr/bin/gs';

  it.skipIf(!fs.existsSync(gs))(
    'writes the PDF/A marker and keeps it when document info is cleared',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pdfa-'));
      const input = path.join(dir, 'in.pdf');
      const archived = path.join(dir, 'archived.pdf');
      const cleared = path.join(dir, 'cleared.pdf');
      fs.writeFileSync(input, pdfWithInfo());

      await compress(input, { gsModule: gs, output: archived, pdfa: '2b' });
      await compress(input, {
        gsModule: gs,
        output: cleared,
        pdfa: '1b',
        sanitize: true,
      });

      const archivedText = fs.readFileSync(archived).toString('latin1');
      expect(archivedText).toContain("pdfaid:part='2'");
      expect(archivedText).toContain("pdfaid:conformance='B'");

      const clearedText = fs.readFileSync(cleared).toString('latin1');
      expect(clearedText).toContain("pdfaid:part='1'");
      expect(clearedText).toContain("pdfaid:conformance='B'");
      expect(clearedText).not.toContain('Secret Author');
      expect(clearedText).not.toContain('Secret Title');
    },
    30000
  );
});
