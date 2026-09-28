import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);
const { extractArchive } = require('../scripts/install');

function writeArchive(destination: string, names: string[]): void {
  const script = `
import io, sys, tarfile
destination = sys.argv[1]
with tarfile.open(destination, 'w:xz') as archive:
    for name in sys.argv[2:]:
        payload = b'ok' if not name.startswith('..') else b'bad'
        info = tarfile.TarInfo(name)
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
`;
  execFileSync('python3', ['-c', script, destination, ...names], {
    stdio: 'pipe',
  });
}

describe('extractArchive', () => {
  it('extracts an archive whose path contains a double quote', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-tar-'));
    const tricky = path.join(root, 'a"b');
    fs.mkdirSync(tricky);
    const archive = path.join(tricky, 'ghostscript.tar.xz');
    const destination = path.join(root, 'out');
    writeArchive(archive, ['inside.txt']);

    await extractArchive(archive, destination);

    expect(fs.readFileSync(path.join(destination, 'inside.txt'), 'utf8')).toBe(
      'ok'
    );
  });

  it('does not write outside the destination when tar is unavailable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-tar-'));
    const archive = path.join(root, 'ghostscript.tar.xz');
    const destination = path.join(root, 'out');
    const outside = path.join(root, 'outside.txt');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tar'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(bin, 'tar'), 0o755);
    writeArchive(archive, ['inside.txt', '../outside.txt']);

    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;
    try {
      await expect(extractArchive(archive, destination)).rejects.toThrow(
        /Failed to extract/
      );
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('extracts a normal archive with Python when tar is unavailable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-tar-'));
    const archive = path.join(root, 'ghostscript.tar.xz');
    const destination = path.join(root, 'out');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tar'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(bin, 'tar'), 0o755);
    writeArchive(archive, ['inside.txt']);

    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;
    try {
      await extractArchive(archive, destination);
      expect(
        fs.readFileSync(path.join(destination, 'inside.txt'), 'utf8')
      ).toBe('ok');
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
