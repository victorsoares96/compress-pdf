import zlib from 'zlib';

export type ImageInspection = {
  images: number;
  maxImageDpi: number | null;
};

type PdfObject = {
  dict: string | null;
  intValue: number | null;
  streamStart: number;
};

type ImageSize = {
  width: number;
  height: number;
};

const IDENTITY = [1, 0, 0, 1, 0, 0];

function isWhitespace(byte: number | undefined): boolean {
  return (
    byte === 0x00 ||
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20
  );
}

function isDelimiter(byte: number | undefined): boolean {
  return (
    isWhitespace(byte) ||
    byte === undefined ||
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  );
}

function skipWhitespace(buf: Buffer, index: number): number {
  let cursor = index;
  while (cursor < buf.length && isWhitespace(buf[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function skipLiteralString(buf: Buffer, index: number): number {
  let cursor = index + 1;
  let depth = 1;
  while (cursor < buf.length && depth > 0) {
    const byte = buf[cursor];
    if (byte === 0x5c) {
      cursor += 2;
    } else if (byte === 0x28) {
      depth += 1;
      cursor += 1;
    } else if (byte === 0x29) {
      depth -= 1;
      cursor += 1;
    } else {
      cursor += 1;
    }
  }
  return cursor;
}

function readDictEnd(buf: Buffer, open: number): number {
  let depth = 0;
  let cursor = open;
  while (cursor < buf.length - 1) {
    const byte = buf[cursor];
    if (byte === 0x25) {
      while (
        cursor < buf.length &&
        buf[cursor] !== 0x0a &&
        buf[cursor] !== 0x0d
      ) {
        cursor += 1;
      }
    } else if (byte === 0x28) {
      cursor = skipLiteralString(buf, cursor);
    } else if (byte === 0x3c && buf[cursor + 1] === 0x3c) {
      depth += 1;
      cursor += 2;
    } else if (byte === 0x3e && buf[cursor + 1] === 0x3e) {
      depth -= 1;
      cursor += 2;
      if (depth === 0) {
        return cursor;
      }
    } else if (byte === 0x3c) {
      cursor += 1;
      while (cursor < buf.length && buf[cursor] !== 0x3e) {
        cursor += 1;
      }
      cursor += 1;
    } else {
      cursor += 1;
    }
  }
  return buf.length;
}

function readLine(
  buf: Buffer,
  index: number
): { line: string; next: number } | null {
  if (index >= buf.length) return null;
  let end = index;
  while (end < buf.length && buf[end] !== 0x0a && buf[end] !== 0x0d) {
    end += 1;
  }
  const line = buf.toString('latin1', index, end);
  let next = end + 1;
  if (buf[end] === 0x0d && buf[next] === 0x0a) {
    next += 1;
  }
  return { line, next };
}

function parseXrefSection(
  buf: Buffer,
  start: number
): { entries: Map<number, number>; prev: number } | null {
  let cursor = skipWhitespace(buf, start);
  const header = readLine(buf, cursor);
  if (!header || header.line.trim() !== 'xref') return null;

  const entries = new Map<number, number>();
  cursor = header.next;
  let trailer = '';

  while (cursor < buf.length) {
    const row = readLine(buf, cursor);
    if (!row) break;
    cursor = row.next;
    const text = row.line.trim();
    if (text.startsWith('trailer')) {
      trailer = text.slice('trailer'.length);
      break;
    }
    const subsection = /^(\d+)\s+(\d+)$/.exec(text);
    if (!subsection) {
      return null;
    }
    const firstId = Number(subsection[1]);
    const count = Number(subsection[2]);
    let index = 0;
    while (index < count) {
      const entry = readLine(buf, cursor);
      if (!entry) return null;
      cursor = entry.next;
      const fields = /^(\d+)\s+(\d+)\s+([nf])/.exec(entry.line.trim());
      if (fields && fields[3] === 'n') {
        entries.set(firstId + index, Number(fields[1]));
      }
      index += 1;
    }
  }

  const trailerStart = buf.indexOf('trailer', start);
  if (trailerStart >= 0) {
    const dictOpen = buf.indexOf('<<', trailerStart);
    if (dictOpen >= 0) {
      trailer = buf.toString('latin1', dictOpen, readDictEnd(buf, dictOpen));
    }
  }

  const prevMatch = /\/Prev\s+(\d+)/.exec(trailer);
  return { entries, prev: prevMatch ? Number(prevMatch[1]) : -1 };
}

function loadXrefOffsets(buf: Buffer): Map<number, number> | null {
  const marker = buf.lastIndexOf('startxref');
  if (marker < 0) return null;
  const markerText = buf.toString(
    'latin1',
    marker,
    Math.min(buf.length, marker + 48)
  );
  const markerMatch = /startxref\s+(\d+)/.exec(markerText);
  if (!markerMatch) return null;

  const offsets = new Map<number, number>();
  const seen = new Set<number>();
  let xrefAt = Number(markerMatch[1]);

  while (xrefAt > 0 && !seen.has(xrefAt)) {
    seen.add(xrefAt);
    const parsed = parseXrefSection(buf, xrefAt);
    if (!parsed) {
      return offsets.size > 0 ? offsets : null;
    }
    parsed.entries.forEach((offset, id) => {
      if (!offsets.has(id)) {
        offsets.set(id, offset);
      }
    });
    xrefAt = parsed.prev;
  }

  return offsets.size > 0 ? offsets : null;
}

function readObjectAt(buf: Buffer, offset: number): PdfObject | null {
  let cursor = skipWhitespace(buf, offset);
  const header = /^(\d+)\s+(\d+)\s+obj/.exec(
    buf.toString('latin1', cursor, Math.min(buf.length, cursor + 32))
  );
  if (!header) return null;
  cursor += header[0].length;
  cursor = skipWhitespace(buf, cursor);

  if (buf[cursor] === 0x3c && buf[cursor + 1] === 0x3c) {
    const dictEnd = readDictEnd(buf, cursor);
    const dict = buf.toString('latin1', cursor, dictEnd);
    let streamStart = -1;
    let after = skipWhitespace(buf, dictEnd);
    if (buf.toString('latin1', after, after + 6) === 'stream') {
      after += 6;
      if (buf[after] === 0x0d && buf[after + 1] === 0x0a) {
        after += 2;
      } else if (buf[after] === 0x0a || buf[after] === 0x0d) {
        after += 1;
      }
      streamStart = after;
    }
    return { dict, intValue: null, streamStart };
  }

  const intMatch = /^(-?\d+)/.exec(
    buf.toString('latin1', cursor, Math.min(buf.length, cursor + 24))
  );
  return {
    dict: null,
    intValue: intMatch ? Number(intMatch[1]) : null,
    streamStart: -1,
  };
}

function loadObjects(buf: Buffer): Map<number, PdfObject> | null {
  const offsets = loadXrefOffsets(buf);
  if (!offsets) return null;
  const objects = new Map<number, PdfObject>();
  offsets.forEach((offset, id) => {
    const parsed = readObjectAt(buf, offset);
    if (parsed) {
      objects.set(id, parsed);
    }
  });
  return objects;
}

function integerValue(
  objects: Map<number, PdfObject>,
  text: string,
  key: string
): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)(?:\\s+(\\d+)\\s+R)?`).exec(text);
  if (!match) return null;
  if (match[2] === undefined) return Number(match[1]);
  const target = objects.get(Number(match[1]));
  return target?.intValue ?? null;
}

function streamBytes(
  buf: Buffer,
  objects: Map<number, PdfObject>,
  objectId: number
): Buffer | null {
  const current = objects.get(objectId);
  if (!current?.dict || current.streamStart < 0) return null;
  const length = integerValue(objects, current.dict, 'Length');
  if (length === null || length < 0) return null;
  const raw = buf.subarray(current.streamStart, current.streamStart + length);
  if (/\/FlateDecode/.test(current.dict)) {
    try {
      return zlib.inflateSync(raw);
    } catch {
      return null;
    }
  }
  if (/\/Filter/.test(current.dict)) return null;
  return raw;
}

function isPage(dict: string): boolean {
  return /\/Type\s*\/Page(?![\w])/.test(dict);
}

function isImage(dict: string): boolean {
  return /\/Subtype\s*\/Image(?![\w])/.test(dict);
}

function contentIds(dict: string): number[] {
  const arrayMatch = /\/Contents\s*\[([^\]]*)\]/.exec(dict);
  const source = arrayMatch
    ? arrayMatch[1]
    : (/\/Contents\s+(\d+)\s+0\s+R/.exec(dict)?.[0] ?? '');
  const ids: number[] = [];
  const ref = /(\d+)\s+0\s+R/g;
  let found = ref.exec(source);
  while (found) {
    ids.push(Number(found[1]));
    found = ref.exec(source);
  }
  return ids;
}

function imageSize(
  objects: Map<number, PdfObject>,
  dict: string
): ImageSize | null {
  const width = integerValue(objects, dict, 'Width');
  const height = integerValue(objects, dict, 'Height');
  if (width === null || height === null) return null;
  return { width, height };
}

function multiply(operand: number[], current: number[]): number[] {
  return [
    operand[0] * current[0] + operand[2] * current[1],
    operand[1] * current[0] + operand[3] * current[1],
    operand[0] * current[2] + operand[2] * current[3],
    operand[1] * current[2] + operand[3] * current[3],
    operand[0] * current[4] + operand[2] * current[5] + operand[4],
    operand[1] * current[4] + operand[3] * current[5] + operand[5],
  ];
}

function placedDpi(pixels: number, axisA: number, axisB: number): number {
  const span = Math.hypot(axisA, axisB);
  if (span <= 0) return 0;
  return (pixels * 72) / span;
}

function readNumber(
  text: string,
  index: number
): { value: number; next: number } | null {
  const match = /^-?\d+(?:\.\d+)?/.exec(text.slice(index));
  if (!match) return null;
  return { value: Number(match[0]), next: index + match[0].length };
}

function inlineComponents(dict: string): number {
  if (/\/(?:CS|ColorSpace)\s*\/(?:RGB|DeviceRGB)(?![\w])/.test(dict)) return 3;
  if (/\/(?:CS|ColorSpace)\s*\/(?:CMYK|DeviceCMYK)(?![\w])/.test(dict))
    return 4;
  return 1;
}

function inlineDataLength(dict: string): number | null {
  const width = /\/W(?:idth)?\s+(\d+)/.exec(dict);
  const height = /\/H(?:eight)?\s+(\d+)/.exec(dict);
  if (!width || !height) return null;
  const bits = /\/BPC\s+(\d+)/.exec(dict);
  const bitCount = bits ? Number(bits[1]) : 1;
  return Math.ceil(
    (Number(width[1]) * Number(height[1]) * bitCount * inlineComponents(dict)) /
      8
  );
}

function skipInlineImage(text: string, idAt: number, dict: string): number {
  const length = inlineDataLength(dict);
  let cursor = idAt + 2;
  if (isWhitespace(text.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (length === null) {
    const end = text.indexOf('EI', cursor);
    return end < 0 ? text.length : end + 2;
  }
  return Math.min(text.length, cursor + length);
}

function walkContent(
  text: string,
  imagesByName: Map<string, ImageSize>,
  remember: (dpi: number) => void,
  countInline: () => void
): void {
  const stack: number[][] = [];
  let ctm = IDENTITY.slice();
  const numbers: number[] = [];
  let lastName = '';
  let cursor = 0;

  while (cursor < text.length) {
    const byte = text.charCodeAt(cursor);
    if (isWhitespace(byte)) {
      cursor += 1;
    } else if (byte === 0x25) {
      while (
        cursor < text.length &&
        text.charCodeAt(cursor) !== 0x0a &&
        text.charCodeAt(cursor) !== 0x0d
      ) {
        cursor += 1;
      }
    } else if (byte === 0x28) {
      cursor = skipLiteralString(Buffer.from(text, 'latin1'), cursor);
    } else if (byte === 0x3c && text.charCodeAt(cursor + 1) !== 0x3c) {
      cursor += 1;
      while (cursor < text.length && text.charCodeAt(cursor) !== 0x3e) {
        cursor += 1;
      }
      cursor += 1;
    } else if (byte === 0x2f) {
      cursor += 1;
      const start = cursor;
      while (cursor < text.length && !isDelimiter(text.charCodeAt(cursor))) {
        cursor += 1;
      }
      lastName = text.slice(start, cursor);
      numbers.length = 0;
    } else if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) {
      const number = readNumber(text, cursor);
      if (!number) {
        cursor += 1;
      } else {
        numbers.push(number.value);
        if (numbers.length > 6) numbers.shift();
        cursor = number.next;
      }
    } else if (isDelimiter(byte)) {
      cursor += 1;
    } else {
      const start = cursor;
      while (cursor < text.length && !isDelimiter(text.charCodeAt(cursor))) {
        cursor += 1;
      }
      const word = text.slice(start, cursor);
      if (word === 'q') {
        stack.push(ctm.slice());
      } else if (word === 'Q' && stack.length > 0) {
        ctm = stack.pop() ?? ctm;
      } else if (word === 'cm' && numbers.length === 6) {
        ctm = multiply(numbers.slice(), ctm);
      } else if (word === 'Do') {
        const size = imagesByName.get(lastName);
        if (size) {
          remember(placedDpi(size.width, ctm[0], ctm[1]));
          remember(placedDpi(size.height, ctm[2], ctm[3]));
        }
      } else if (word === 'BI') {
        const idAt = text.indexOf('ID', cursor);
        if (idAt < 0) {
          cursor = text.length;
        } else {
          const dict = text.slice(cursor, idAt);
          const width = /\/W(?:idth)?\s+(\d+)/.exec(dict);
          const height = /\/H(?:eight)?\s+(\d+)/.exec(dict);
          countInline();
          if (width && height) {
            remember(placedDpi(Number(width[1]), ctm[0], ctm[1]));
            remember(placedDpi(Number(height[1]), ctm[2], ctm[3]));
          }
          cursor = skipInlineImage(text, idAt, dict);
        }
      }
      numbers.length = 0;
    }
  }
}

/**
 * Count image XObjects and inline images, and the highest DPI at which
 * an image is actually drawn. DPI uses the current transform: pixels
 * divided by the on-page size in inches.
 */
export function inspectPdfImages(pdf: Buffer): ImageInspection {
  const objects = loadObjects(pdf);
  if (!objects) {
    return { images: 0, maxImageDpi: null };
  }

  const imagesById = new Map<number, ImageSize>();
  const imagesByName = new Map<string, ImageSize>();
  objects.forEach((current, id) => {
    if (!current.dict || !isImage(current.dict)) return;
    const size = imageSize(objects, current.dict);
    if (!size) return;
    imagesById.set(id, size);
    const named = /\/Name\s*\/([^\s/>[\]]+)/.exec(current.dict);
    if (named) {
      imagesByName.set(named[1], size);
    }
  });

  objects.forEach((current) => {
    if (!current.dict) return;
    const ref = /\/([^\s/>[\]]+)\s+(\d+)\s+0\s+R/g;
    let found = ref.exec(current.dict);
    while (found) {
      const size = imagesById.get(Number(found[2]));
      if (size) {
        imagesByName.set(found[1], size);
      }
      found = ref.exec(current.dict);
    }
  });

  let inlineImages = 0;
  let maxImageDpi: number | null = null;
  const remember = (dpi: number) => {
    if (!Number.isFinite(dpi) || dpi <= 0) return;
    const rounded = Math.round(dpi);
    if (maxImageDpi === null || rounded > maxImageDpi) {
      maxImageDpi = rounded;
    }
  };

  objects.forEach((current) => {
    if (!current.dict || !isPage(current.dict)) return;
    const parts: string[] = [];
    const contents = contentIds(current.dict);
    let index = 0;
    while (index < contents.length) {
      const bytes = streamBytes(pdf, objects, contents[index]);
      index += 1;
      if (bytes) {
        parts.push(bytes.toString('latin1'));
      }
    }
    if (parts.length > 0) {
      walkContent(parts.join('\n'), imagesByName, remember, () => {
        inlineImages += 1;
      });
    }
  });

  return {
    images: imagesById.size + inlineImages,
    maxImageDpi,
  };
}
