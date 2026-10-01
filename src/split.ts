import fs from 'fs';
import os from 'os';
import path from 'path';
import { pdfPageCount } from './analyze';
import compress from './compress';
import { assertPagesWithin, expandPages, parsePages } from './pages';
import { holdPdf } from './pdf-source';
import {
  CompressPdfError,
  type Options,
  type PdfSource,
  type SplitOptions,
  type SplitResult,
} from './types';

const CONCURRENCY_CAP = 4;

function outputPattern(value: string): string {
  const placeholders = value.split('%d').length - 1;
  if (placeholders !== 1) {
    throw new CompressPdfError(
      `split output must contain %d once, got ${value}`
    );
  }
  return value;
}

function assertDistinctPages(numbers: readonly number[]): void {
  const seen = new Set<number>();
  numbers.forEach((page) => {
    if (seen.has(page)) {
      throw new CompressPdfError(
        `split cannot write the same page twice, got ${page}`
      );
    }
    seen.add(page);
  });
}

async function removeFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(
    paths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined))
  );
}

function withoutSplitFields(options: SplitOptions): Options {
  const next: SplitOptions = { ...options };
  delete next.output;
  delete next.pages;
  delete next.returnOriginalIfLarger;
  delete next.concurrency;
  delete next.signal;
  return next;
}

function defaultConcurrency(): number {
  const cores = os.availableParallelism();
  return Math.max(1, Math.min(cores, CONCURRENCY_CAP));
}

function assertConcurrency(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new CompressPdfError(
      `concurrency must be a positive integer, got ${value}`
    );
  }
}

function workerCount(requested: number | undefined, pages: number): number {
  const limit = requested ?? defaultConcurrency();
  return Math.min(limit, pages);
}

type PagePool = {
  signal: AbortSignal;
  abort: () => void;
  close: () => void;
};

/**
 * One controller for every page. Aborting it stops the Ghostscript
 * runs still in flight. A caller signal aborts this pool too.
 */
function openPool(user?: AbortSignal): PagePool {
  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (!user) {
    return {
      signal: controller.signal,
      abort,
      close() {
        return undefined;
      },
    };
  }
  if (user.aborted) {
    abort();
    return {
      signal: controller.signal,
      abort,
      close() {
        return undefined;
      },
    };
  }
  const onAbort = (): void => abort();
  user.addEventListener('abort', onAbort);
  return {
    signal: controller.signal,
    abort,
    close() {
      user.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Compress each page on its own Ghostscript run.
 * At most `concurrency` runs share the machine. `files` stays in
 * the requested page order. The first failure aborts the rest
 * and deletes every file this split started.
 */
async function compressPages(input: {
  filePath: string;
  numbers: readonly number[];
  pattern: string;
  shared: Options;
  concurrency: number;
  signal?: AbortSignal;
}): Promise<string[]> {
  const files = new Array<string>(input.numbers.length);
  const started: string[] = [];
  let cursor = 0;
  let failure: unknown;
  const pool = openPool(input.signal);

  const worker = async (): Promise<void> => {
    // A worker waits on Ghostscript, then takes the next page.
    /* eslint-disable no-await-in-loop */
    for (;;) {
      if (failure !== undefined || pool.signal.aborted) return;
      const index = cursor;
      if (index >= input.numbers.length) return;
      cursor += 1;
      const page = input.numbers[index];
      const destination = path.resolve(
        input.pattern.replace('%d', String(page))
      );
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      started.push(destination);
      if (failure !== undefined || pool.signal.aborted) return;
      try {
        await compress(input.filePath, {
          ...input.shared,
          pages: String(page),
          output: destination,
          signal: pool.signal,
        });
        files[index] = destination;
      } catch (error) {
        if (failure === undefined) {
          failure = error;
          pool.abort();
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  };

  try {
    const width = workerCount(input.concurrency, input.numbers.length);
    await Promise.all(Array.from({ length: width }, () => worker()));
  } catch (error) {
    if (failure === undefined) {
      failure = error;
      pool.abort();
    }
  } finally {
    pool.close();
  }

  if (failure !== undefined || pool.signal.aborted) {
    await removeFiles(started);
    if (failure instanceof Error) throw failure;
    throw new CompressPdfError(
      pool.signal.aborted
        ? 'Ghostscript compression was aborted.'
        : 'Ghostscript failed to compress the PDF.'
    );
  }

  return files;
}

/**
 * Write one compressed PDF per page.
 * `output` must contain `%d`, replaced with the source page number.
 * Pages run together up to `concurrency` (CPU count, capped at 4).
 */
async function split(
  file: PdfSource,
  options: SplitOptions & { output: string }
): Promise<SplitResult> {
  const startTime = Date.now();
  const pattern = outputPattern(options.output);
  if (options.returnOriginalIfLarger) {
    throw new CompressPdfError(
      'returnOriginalIfLarger cannot be used when splitting a PDF'
    );
  }
  assertConcurrency(options.concurrency);
  if (options.signal?.aborted) {
    throw new CompressPdfError('Ghostscript compression was aborted.');
  }

  const pageList =
    options.pages !== undefined ? parsePages(options.pages) : undefined;
  const held = await holdPdf(file);
  try {
    const count = await pdfPageCount(held.filePath, {
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
    assertDistinctPages(numbers);

    const files = await compressPages({
      filePath: held.filePath,
      numbers,
      pattern,
      shared: withoutSplitFields(options),
      concurrency: options.concurrency ?? defaultConcurrency(),
      signal: options.signal,
    });

    return {
      files,
      duration: Date.now() - startTime,
    };
  } finally {
    if (held.temp) {
      await fs.promises.unlink(held.filePath).catch(() => undefined);
    }
  }
}

export default split;
