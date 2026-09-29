import { CompressPdfError, type PdfMetadata } from './types';

const INFO_FIELDS = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords'],
] as const;

const METADATA_KEYS = ['title', 'author', 'subject', 'keywords'] as const;

export function assertMetadata(metadata: PdfMetadata | undefined): void {
  if (metadata === undefined) return;
  if (typeof metadata !== 'object' || metadata === null) {
    throw new CompressPdfError('setMetadata must be an object');
  }

  METADATA_KEYS.forEach((key) => {
    const value = metadata[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new CompressPdfError(`setMetadata.${key} must be a string`);
    }
  });
}

/**
 * PostScript text for a pdfmark. Printable ASCII stays in parentheses.
 * Anything else is UTF-16BE with a BOM, which PDF info strings understand.
 */
function postscriptText(value: string): string {
  const characters = Array.from(value);
  const needsHex = characters.some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code > 126;
  });
  if (!needsHex) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
    return `(${escaped})`;
  }

  const hex = characters.reduce((encoded, character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0xffff) {
      return encoded + code.toString(16).toUpperCase().padStart(4, '0');
    }
    const adjusted = code - 0x10000;
    const high = 0xd800 + Math.floor(adjusted / 0x400);
    const low = 0xdc00 + (adjusted % 0x400);
    return (
      encoded +
      high.toString(16).toUpperCase().padStart(4, '0') +
      low.toString(16).toUpperCase().padStart(4, '0')
    );
  }, 'FEFF');
  return `<${hex}>`;
}

/**
 * pdfmark applied after the input file, so it overrides info copied from
 * the original. Clearing the info also makes Ghostscript rebuild XMP
 * from the new values instead of keeping the original metadata block.
 */
export function buildDocinfoProgram(options: {
  stripMetadata: boolean;
  sanitize: boolean;
  setMetadata?: PdfMetadata;
}): string | undefined {
  const clear = options.stripMetadata || options.sanitize;
  const metadata = options.setMetadata ?? {};
  const entries: string[] = [];

  INFO_FIELDS.forEach(([key, name]) => {
    const value = metadata[key];
    if (typeof value === 'string') {
      entries.push(`/${name} ${postscriptText(value)}`);
    } else if (clear) {
      entries.push(`/${name} ()`);
    }
  });

  if (clear) {
    entries.push('/Creator ()');
  }
  if (entries.length === 0) return undefined;
  return `[ ${entries.join(' ')} /DOCINFO pdfmark`;
}
