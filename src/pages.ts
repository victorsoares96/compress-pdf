import { CompressPdfError } from './types';

const RANGE = /^(\d+)-(\d+)$/;
const SINGLE = /^(\d+)$/;

function pageNumber(text: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new CompressPdfError(`pages must be a list like 1-3,5, got ${text}`);
  }
  return value;
}

/**
 * Turn a page list into Ghostscript's PageList form.
 * Pages are numbered from 1. `5-1` stays backwards.
 */
export function parsePages(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CompressPdfError(
      `pages must be a list like 1-3,5, got ${JSON.stringify(value)}`
    );
  }

  const canonical = value.split(',').map((part) => {
    const piece = part.trim();
    const range = RANGE.exec(piece);
    if (range) {
      const start = pageNumber(range[1]);
      const end = pageNumber(range[2]);
      if (start === end) return String(start);
      return `${start}-${end}`;
    }
    const single = SINGLE.exec(piece);
    if (single) return String(pageNumber(single[1]));
    throw new CompressPdfError(
      `pages must be a list like 1-3,5, got ${JSON.stringify(value)}`
    );
  });

  return canonical.join(',');
}

/** Expand a canonical list, keeping reverse ranges in that order. */
export function expandPages(list: string): number[] {
  const pages: number[] = [];
  list.split(',').forEach((part) => {
    const bounds = part.split('-');
    const start = Number(bounds[0]);
    const end = bounds.length === 1 ? start : Number(bounds[1]);
    const step = start <= end ? 1 : -1;
    let page = start;
    while (step > 0 ? page <= end : page >= end) {
      pages.push(page);
      page += step;
    }
  });
  return pages;
}

function farthestPage(part: string): number {
  const bounds = part.split('-');
  const start = Number(bounds[0]);
  const end = bounds.length === 1 ? start : Number(bounds[1]);
  return start > end ? start : end;
}

export function assertPagesWithin(list: string, count: number): void {
  const tooFar = list
    .split(',')
    .map(farthestPage)
    .find((page) => page > count);
  if (tooFar !== undefined) {
    const noun = count === 1 ? 'page' : 'pages';
    throw new CompressPdfError(
      `pages goes past the end of the PDF (${count} ${noun}), got ${tooFar}`
    );
  }
}
