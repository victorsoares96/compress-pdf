import type pdfParser from 'pdf-parse';

// https://gitlab.com/autokent/pdf-parse/-/issues/24
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFParser = require('pdf-parse');

export async function parsePDF(
  src: unknown,
  options?: pdfParser.Options
): Promise<pdfParser.Result> {
  const data = await PDFParser(src, options);

  return data;
}
