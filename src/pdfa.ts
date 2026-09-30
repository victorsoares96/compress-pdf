import fs from 'fs';
import path from 'path';
import { CompressPdfError, type PdfaLevel } from './types';

const PDFA_LEVELS: readonly PdfaLevel[] = ['1b', '2b', '3b'];

export function isPdfaLevel(value: unknown): value is PdfaLevel {
  return typeof value === 'string' && PDFA_LEVELS.includes(value as PdfaLevel);
}

export function assertPdfa(value: unknown): void {
  if (value === undefined) return;
  if (!isPdfaLevel(value)) {
    throw new CompressPdfError(
      `pdfa must be 1b, 2b, or 3b, got ${String(value)}`
    );
  }
}

/** PDF version required by that PDF/A level. */
export function pdfaCompatibility(level: PdfaLevel): 1.4 | 1.7 {
  return level === '1b' ? 1.4 : 1.7;
}

function pdfaPart(level: PdfaLevel): 1 | 2 | 3 {
  if (level === '1b') return 1;
  if (level === '2b') return 2;
  return 3;
}

/**
 * Flags for one Ghostscript run. Policy 1 drops features that cannot
 * be kept, so the file can still be PDF/A.
 */
export function pdfaFlags(level: PdfaLevel): string[] {
  const flags = [
    `-dPDFA=${pdfaPart(level)}`,
    '-sColorConversionStrategy=RGB',
    '-dPDFACompatibilityPolicy=1',
  ];
  if (level !== '1b') {
    flags.push('-sBlendConversionStrategy=Simple');
  }
  return flags;
}

function postscriptPath(filePath: string): string {
  const escaped = filePath
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  return `(${escaped})`;
}

/**
 * Definition file Ghostscript reads before the input PDF.
 * It attaches an RGB output intent using the given ICC profile.
 */
export function buildPdfaDefinition(iccPath: string): string {
  return [
    '%!',
    '[ /_objdef {icc_PDFA} /type /stream /OBJ pdfmark',
    '[ {icc_PDFA} << /N 3 >> /PUT pdfmark',
    `[ {icc_PDFA} ${postscriptPath(iccPath)} /PUTFILE pdfmark`,
    '[ /_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark',
    '[ {OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB) >> /PUT pdfmark',
    '[ {Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark',
    '',
  ].join('\n');
}

function iccIn(dir: string): string | undefined {
  const candidate = path.join(dir, 'iccprofiles', 'default_rgb.icc');
  if (fs.existsSync(candidate)) return candidate;
  return undefined;
}

function newerVersion(current: string, next: string): string {
  const currentParts = current.split('.').map((part) => Number(part));
  const nextParts = next.split('.').map((part) => Number(part));
  const length = Math.max(currentParts.length, nextParts.length);
  let index = 0;
  while (index < length) {
    const difference = (nextParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? next : current;
    index += 1;
  }
  return current;
}

/**
 * Ghostscript's RGB profile, next to that install.
 * Official builds keep it in `iccprofiles` beside the `bin` folder.
 * Debian and Homebrew keep it under `share/ghostscript/<version>/iccprofiles`.
 */
export function findDefaultRgbIcc(gsModule: string): string {
  let binDir: string;
  try {
    binDir = path.dirname(fs.realpathSync(gsModule));
  } catch (error) {
    throw new CompressPdfError(
      `default_rgb.icc was not found next to Ghostscript at ${gsModule}`,
      error
    );
  }

  const besideBinary = iccIn(binDir) ?? iccIn(path.resolve(binDir, '..'));
  if (besideBinary) return besideBinary;

  const share = path.resolve(binDir, '../share/ghostscript');
  if (fs.existsSync(share)) {
    const match = fs
      .readdirSync(share)
      .reduce<string | undefined>((best, name) => {
        const candidate = iccIn(path.join(share, name));
        if (!candidate) return best;
        if (!best) return name;
        return newerVersion(best, name);
      }, undefined);
    if (match) {
      const found = iccIn(path.join(share, match));
      if (found) return found;
    }
  }

  throw new CompressPdfError(
    `default_rgb.icc was not found next to Ghostscript at ${gsModule}`
  );
}
