import fs from 'fs';
import path from 'path';
import { pdfPageCount } from './analyze';
import compress from './compress';
import { assertPagesWithin, expandPages, parsePages } from './pages';
import { CompressPdfError, type Options, type SplitResult } from './types';

function outputPattern(value: string): string {
  const placeholders = value.split('%d').length - 1;
  if (placeholders !== 1) {
    throw new CompressPdfError(
      `split output must contain %d once, got ${value}`
    );
  }
  return value;
}

function withoutSplitFields(options: Options): Options {
  const next: Options = { ...options };
  delete next.output;
  delete next.pages;
  delete next.returnOriginalIfLarger;
  return next;
}

/**
 * Write one compressed PDF per page.
 * `output` must contain `%d`, replaced with the source page number.
 */
async function split(
  file: string | Buffer,
  options: Options & { output: string }
): Promise<SplitResult> {
  const startTime = Date.now();
  const pattern = outputPattern(options.output);
  if (options.returnOriginalIfLarger) {
    throw new CompressPdfError(
      'returnOriginalIfLarger cannot be used when splitting a PDF'
    );
  }

  const pageList =
    options.pages !== undefined ? parsePages(options.pages) : undefined;
  const count = await pdfPageCount(file, {
    gsModule: options.gsModule,
    pdfPassword: options.pdfPassword,
    timeout: options.timeout,
    signal: options.signal,
  });
  if (pageList !== undefined) {
    assertPagesWithin(pageList, count);
  }
  const numbers = pageList
    ? expandPages(pageList)
    : Array.from({ length: count }, (_item, index) => index + 1);
  if (numbers.length === 0) {
    throw new CompressPdfError('the PDF has no pages');
  }

  const shared = withoutSplitFields(options);
  const files: string[] = [];
  let index = 0;

  // Each page is its own Ghostscript run, in the requested order.
  /* eslint-disable no-await-in-loop */
  while (index < numbers.length) {
    const page = numbers[index];
    index += 1;
    const destination = path.resolve(pattern.replace('%d', String(page)));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await compress(file, {
      ...shared,
      pages: String(page),
      output: destination,
    });
    files.push(destination);
  }
  /* eslint-enable no-await-in-loop */

  return {
    files,
    duration: Date.now() - startTime,
  };
}

export default split;
