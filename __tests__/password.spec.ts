import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import compress from '../src/compress';
import { CompressPdfError } from '../src/types';

const PASSWORD = 'S3nh@Secreta';

function writeFakeGs(dir: string): string {
  const bin = path.join(dir, 'fake-gs.js');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outArg = args.find((arg) => arg.startsWith('-sOutputFile='));
if (outArg) {
  fs.writeFileSync(outArg.slice('-sOutputFile='.length), '%PDF-1.4 fake\\n');
}
console.error('gs rejected the file');
process.exit(1);
`
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

describe('PDF password errors', () => {
  it('does not include the password in the error message, stack, or cause', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-pdf-pw-'));
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    const bin = writeFakeGs(dir);

    const failure = await compress(pdf, {
      pdfPassword: PASSWORD,
      gsModule: bin,
    }).then(
      () => {
        throw new Error('expected compress to fail');
      },
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(CompressPdfError);
    const error = failure as CompressPdfError;
    const exposed = [error.message, error.stack, String(error.cause)].join(
      '\n'
    );
    expect(exposed).not.toContain(PASSWORD);
    expect(error.message).toContain('gs rejected the file');
    expect(error.message).not.toContain('-sPDFPassword');
  });
});
