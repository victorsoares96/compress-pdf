import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';

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
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4\\n%fake\\n');
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

describe('jpegQuality', () => {
  it('sets the JPEG factor and recompresses photos already stored as JPEG', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-jpeg-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: writeRecordingGs(dir), jpegQuality: 62 });

    const args = recordedArgs(dir)[0];
    const programAt = args.indexOf('-c');
    const fileSwitch = args.indexOf('-f');
    const program = args[programAt + 1];
    expect(args).toContain('-dPassThroughJPEGImages=false');
    expect(programAt).toBeGreaterThan(-1);
    expect(fileSwitch).toBe(programAt + 2);
    expect(args[fileSwitch + 1]).toBe(path.resolve(pdf));
    expect(program).toContain('setdistillerparams');
    expect(program).toContain('/QFactor 0.76');
    expect(program).toContain('/ColorImageDict');
    expect(program).toContain('/GrayImageDict');
    expect(program).toContain('/ColorACSImageDict');
    expect(program).toContain('/GrayACSImageDict');
    expect(program).toContain('/HSamples [1 1 1 1]');
    expect(program).toContain('/VSamples [1 1 1 1]');
    expect(program).toContain('/ColorTransform 1');
    expect(program).toContain('/AutoFilterColorImages false');
    expect(program).toContain('/ColorImageFilter /DCTEncode');
    expect(program).toContain('/AutoFilterGrayImages false');
    expect(program).toContain('/GrayImageFilter /DCTEncode');
    const gray = program.split('/GrayImageDict ')[1]?.split(' >> ')[0] ?? '';
    expect(gray).not.toContain('ColorTransform');
  });

  it('leaves JPEG settings alone when the option is omitted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-jpeg-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, { gsModule: writeRecordingGs(dir) });

    const args = recordedArgs(dir)[0];
    expect(args).not.toContain('-dPassThroughJPEGImages=false');
    expect(args.includes('-c')).toBe(false);
  });

  it('maps the ends of the quality range', async () => {
    const expectations = [
      [100, '0.15'],
      [50, '1.00'],
      [1, '1.98'],
    ] as const;

    await Promise.all(
      expectations.map(async ([quality, factor]) => {
        const dir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'compress-pdf-jpeg-')
        );
        const pdf = path.join(dir, 'in.pdf');
        fs.writeFileSync(pdf, '%PDF-1.4\n');
        await compress(pdf, {
          gsModule: writeRecordingGs(dir),
          jpegQuality: quality,
        });
        const program =
          recordedArgs(dir)[0][recordedArgs(dir)[0].indexOf('-c') + 1];
        expect(program).toContain(`/QFactor ${factor}`);
      })
    );
  });

  it('rejects a quality outside 1 to 100 before Ghostscript runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-jpeg-'));
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
      compress(pdf, { gsModule: bin, jpegQuality: 0 })
    ).rejects.toThrow(/integer from 1 to 100/);
    await expect(
      compress(pdf, { gsModule: bin, jpegQuality: 101 })
    ).rejects.toThrow(/integer from 1 to 100/);
    await expect(
      compress(pdf, { gsModule: bin, jpegQuality: 1.5 })
    ).rejects.toThrow(/integer from 1 to 100/);
    await expect(
      compress(pdf, { gsModule: bin, jpegQuality: Number.NaN })
    ).rejects.toThrow(/integer from 1 to 100/);
    expect(fs.existsSync(called)).toBe(false);
  });

  it('puts document info after the file when JPEG quality is set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-jpeg-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      jpegQuality: 60,
      stripMetadata: true,
    });

    const args = recordedArgs(dir)[0];
    const jpegAt = args.indexOf('-c');
    const fileSwitch = args.indexOf('-f');
    const infoAt = args.lastIndexOf('-c');
    expect(jpegAt).toBeLessThan(fileSwitch);
    expect(args[fileSwitch + 1]).toBe(path.resolve(pdf));
    expect(infoAt).toBeGreaterThan(fileSwitch);
    expect(args[infoAt + 1]).toContain('/Author ()');
    expect(args[jpegAt + 1]).toContain('setdistillerparams');
  });

  it('sends the same JPEG program on every targetSize attempt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-jpeg-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 original\n');

    await compress(pdf, {
      gsModule: writeRecordingGs(dir),
      jpegQuality: 62,
      targetSize: 10,
    });

    const calls = recordedArgs(dir);
    expect(calls.length).toBeGreaterThan(1);
    calls.forEach((args) => {
      expect(args).toContain('-dPassThroughJPEGImages=false');
      expect(args[args.indexOf('-c') + 1]).toContain('/QFactor 0.76');
    });
  });
});

function jpegPhoto(dir: string, gs: string): string {
  const raw = path.join(dir, 'noise.raw');
  const ps = path.join(dir, 'noise.ps');
  const jpg = path.join(dir, 'noise.jpg');
  const pdf = path.join(dir, 'photo.pdf');
  const width = 160;
  const height = 160;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const mixed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    pixels[index] = Math.floor((mixed - Math.floor(mixed)) * 256);
  }
  fs.writeFileSync(raw, pixels);
  const postscript = `%!PS
<< /PageSize [${width} ${height}] >> setpagedevice
/row ${width * 3} string def
/src (${raw}) (r) file def
${width} ${height} 8 [1 0 0 -1 0 ${height}]
{ src row readstring pop } false 3 colorimage
showpage
`;
  fs.writeFileSync(ps, postscript);
  execFileSync(gs, [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dNOSAFER',
    '-sDEVICE=jpeg',
    '-dJPEGQ=70',
    '-r72',
    `-g${width}x${height}`,
    `-sOutputFile=${jpg}`,
    ps,
  ]);
  execFileSync(gs, [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-sDEVICE=pdfwrite',
    `-sOutputFile=${pdf}`,
    'viewjpeg.ps',
    '-c',
    `(${jpg}) viewJPEG`,
  ]);
  return pdf;
}

describe('jpegQuality with Ghostscript', () => {
  const gs = '/usr/bin/gs';

  it.skipIf(!fs.existsSync(gs))(
    'keeps the photo as JPEG and writes a smaller file at a lower quality',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-jpeg-'));
      const input = jpegPhoto(dir, gs);
      const sharp = path.join(dir, 'sharp.pdf');
      const small = path.join(dir, 'small.pdf');

      await compress(input, {
        gsModule: gs,
        output: sharp,
        jpegQuality: 100,
      });
      await compress(input, {
        gsModule: gs,
        output: small,
        jpegQuality: 1,
      });

      const sharpBytes = fs.readFileSync(sharp);
      const smallBytes = fs.readFileSync(small);
      expect(sharpBytes.includes(Buffer.from('DCTDecode'))).toBe(true);
      expect(smallBytes.includes(Buffer.from('DCTDecode'))).toBe(true);
      expect(smallBytes.length).toBeLessThan(sharpBytes.length * 0.8);
    },
    30000
  );
});
