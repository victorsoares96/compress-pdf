import fs from 'fs';
import type pdfParser from 'pdf-parse';

// https://gitlab.com/autokent/pdf-parse/-/issues/24
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFParser = require('pdf-parse');

export async function parsePDF(
  file: string | Buffer,
  options?: pdfParser.Options
): Promise<pdfParser.Result> {
  let dataBuffer: Buffer;

  if (typeof file === 'string') {
    dataBuffer = fs.readFileSync(file);
  } else dataBuffer = file;

  const data = await PDFParser(dataBuffer, options);

  return data;
}
