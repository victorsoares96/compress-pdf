/* eslint-disable no-console */
import { parseArgs } from 'node:util';
import { pipeline } from 'node:stream/promises';
import fs from 'fs';
import compress, { compressStream } from '@/compress';
import split from '@/split';
import {
  VALID_RESOLUTIONS,
  type PdfMetadata,
  type PdfaLevel,
  type ResolutionSetting,
} from './types';
import { isPdfaLevel } from './pdfa';
import { parsePages } from './pages';

export const helpText = `
compress-pdf - Compress PDF files using Ghostscript

Usage:
  npx compress-pdf --file <input> --output <output> [options]

Required:
  -f, --file <path>          Path to a PDF. Repeat to join files. Use - for stdin
  -o, --output <path>        Where to write. Use %d for one file per page, or - for stdout

Options:
  -r, --resolution <preset>  screen | ebook | printer | prepress | default | auto
                             (default: ebook). auto picks screen, ebook, or printer
  --pages <list>             Pages to keep, such as 1-3,5
  --compatibilityLevel <n>   PDF compatibility level (default: 1.4)
  --pdfa <level>             Write PDF/A in the same pass: 1b, 2b, or 3b
  --imageQuality <n>         Image resolution/quality in DPI, 1-600 (default: 100)
  --gsModule <path>          Custom Ghostscript binary path
  --pdfPassword <pass>       Password for protected PDFs.
                             Stored in shell history; prefer COMPRESS_PDF_PASSWORD
  --removePasswordAfterCompression
                             Remove password protection after compression
  --returnOriginalIfLarger   Keep the original PDF when compression is not smaller
  --targetSize <bytes>       Keep trying milder settings until the file fits
  --stripMetadata            Clear title, author, subject, keywords, and creator
  --sanitize                 Clear document info, including the extra metadata block
  --title <text>             Set the compressed PDF title
  --author <text>            Set the compressed PDF author
  --subject <text>           Set the compressed PDF subject
  --keywords <text>          Set the compressed PDF keywords
  -h, --help                 Show this help message

Environment:
  COMPRESS_PDF_PASSWORD      PDF password when --pdfPassword is omitted

Examples:
  npx compress-pdf -f input.pdf -o output.pdf
  npx compress-pdf -f input.pdf -o output.pdf -r screen
  npx compress-pdf -f input.pdf -o output.pdf --imageQuality 72
  npx compress-pdf -f protected.pdf -o output.pdf --pdfPassword mypass
  npx compress-pdf -f input.pdf -o output.pdf --stripMetadata
  npx compress-pdf -f input.pdf -o output.pdf --title "Report" --author "Ada"
  npx compress-pdf -f input.pdf -o output.pdf --pdfa 1b
  npx compress-pdf -f a.pdf -f b.pdf -o merged.pdf
  npx compress-pdf -f input.pdf -o page-%d.pdf --pages 1-3
  npx compress-pdf -f - -o compressed.pdf < input.pdf
  npx compress-pdf -f input.pdf -o - > compressed.pdf
`;

function getStringValue(
  value: string | boolean | string[] | undefined
): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function fileList(value: string | boolean | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}

function metadataFromFlags(values: {
  title?: string | boolean;
  author?: string | boolean;
  subject?: string | boolean;
  keywords?: string | boolean;
}): PdfMetadata | undefined {
  const title = getStringValue(values.title);
  const author = getStringValue(values.author);
  const subject = getStringValue(values.subject);
  const keywords = getStringValue(values.keywords);
  const metadata: PdfMetadata = {};
  if (title !== undefined) metadata.title = title;
  if (author !== undefined) metadata.author = author;
  if (subject !== undefined) metadata.subject = subject;
  if (keywords !== undefined) metadata.keywords = keywords;
  if (Object.keys(metadata).length === 0) return undefined;
  return metadata;
}

const cliOptions = {
  file: { type: 'string', short: 'f', multiple: true },
  pages: { type: 'string' },
  output: { type: 'string', short: 'o' },
  resolution: { type: 'string', short: 'r' },
  compatibilityLevel: { type: 'string' },
  pdfa: { type: 'string' },
  imageQuality: { type: 'string' },
  gsModule: { type: 'string' },
  pdfPassword: { type: 'string' },
  removePasswordAfterCompression: { type: 'boolean', default: false },
  returnOriginalIfLarger: { type: 'boolean', default: false },
  targetSize: { type: 'string' },
  stripMetadata: { type: 'boolean', default: false },
  sanitize: { type: 'boolean', default: false },
  title: { type: 'string' },
  author: { type: 'string' },
  subject: { type: 'string' },
  keywords: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

function parseCliArgs(userArgs: readonly string[]) {
  return parseArgs({
    args: [...userArgs],
    options: cliOptions,
    strict: true,
  });
}

/**
 * Run the CLI with the given argument list (same shape as process.argv.slice(2)).
 * Returns a process exit code (0 success, 1 error).
 */
export async function runCli(userArgs: readonly string[]): Promise<number> {
  let values: ReturnType<typeof parseCliArgs>['values'];
  try {
    ({ values } = parseCliArgs(userArgs));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${message}\n\n${helpText}`);
    return 1;
  }

  if (values.help || userArgs.length === 0) {
    console.log(helpText);
    return 0;
  }

  const files = fileList(values.file);
  const output = getStringValue(values.output);
  const resolution = getStringValue(values.resolution);
  const compatibilityLevel = getStringValue(values.compatibilityLevel);
  const pdfa = getStringValue(values.pdfa);
  const imageQuality = getStringValue(values.imageQuality);
  const gsModule = getStringValue(values.gsModule);
  const targetSize = getStringValue(values.targetSize);
  const pagesText = getStringValue(values.pages);
  const pdfPassword =
    getStringValue(values.pdfPassword) ?? process.env.COMPRESS_PDF_PASSWORD;

  if (files.length === 0 || !output) {
    console.error(
      'Error: --file and --output are required.\n\nRun with --help for usage information.'
    );
    return 1;
  }

  const stdinCount = files.filter((filePath) => filePath === '-').length;
  if (stdinCount > 1) {
    console.error(`Error: stdin can only be read once\n\n${helpText}`);
    return 1;
  }

  const missing = files.find(
    (filePath) => filePath !== '-' && !fs.existsSync(filePath)
  );
  if (missing) {
    console.error(`Error: File not found: ${missing}`);
    return 1;
  }

  if (pagesText !== undefined) {
    try {
      parsePages(pagesText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}\n\n${helpText}`);
      return 1;
    }
  }

  const placeholders = output.split('%d').length - 1;
  if (placeholders > 1) {
    console.error(
      `Error: split output must contain %d once, got ${output}\n\n${helpText}`
    );
    return 1;
  }
  const toStdout = output === '-';
  const splitting = placeholders === 1;
  if (files.length > 1 && pagesText !== undefined) {
    console.error(
      `Error: pages cannot be used when compressing more than one PDF\n\n${helpText}`
    );
    return 1;
  }
  if (files.length > 1 && splitting) {
    console.error(
      `Error: an output path with %d cannot be used with more than one --file\n\n${helpText}`
    );
    return 1;
  }
  if (splitting && values.returnOriginalIfLarger) {
    console.error(
      `Error: returnOriginalIfLarger cannot be used when splitting a PDF\n\n${helpText}`
    );
    return 1;
  }

  if (pdfa !== undefined && !isPdfaLevel(pdfa)) {
    console.error(`Error: Invalid pdfa "${pdfa}". Must be one of: 1b, 2b, 3b`);
    return 1;
  }

  if (
    resolution &&
    resolution !== 'auto' &&
    !VALID_RESOLUTIONS.includes(
      resolution as (typeof VALID_RESOLUTIONS)[number]
    )
  ) {
    console.error(
      `Error: Invalid resolution "${resolution}". Must be one of: ${VALID_RESOLUTIONS.join(', ')}, auto`
    );
    return 1;
  }

  const shared = {
    resolution: resolution ? (resolution as ResolutionSetting) : undefined,
    compatibilityLevel: compatibilityLevel
      ? Number(compatibilityLevel)
      : undefined,
    pdfa: pdfa as PdfaLevel | undefined,
    imageQuality: imageQuality ? Number(imageQuality) : undefined,
    gsModule,
    pdfPassword,
    removePasswordAfterCompression:
      values.removePasswordAfterCompression as boolean,
    returnOriginalIfLarger: values.returnOriginalIfLarger as boolean,
    targetSize: targetSize ? Number(targetSize) : undefined,
    stripMetadata: values.stripMetadata as boolean,
    sanitize: values.sanitize as boolean,
    setMetadata: metadataFromFlags(values),
    ...(pagesText !== undefined ? { pages: pagesText } : {}),
    ...(toStdout ? {} : { output }),
  };

  const asInput = (filePath: string): string | typeof process.stdin =>
    filePath === '-' ? process.stdin : filePath;
  const source = files.length === 1 ? asInput(files[0]) : files.map(asInput);

  try {
    if (splitting) {
      const result = await split(files[0] === '-' ? process.stdin : files[0], {
        ...shared,
        output,
      });
      console.log('✅ PDF split successfully!');
      console.log(`   ${result.files.length} files`);
      console.log(`   Time: ${result.duration}ms`);
      result.files.forEach((filePath) => {
        console.log(`   Output: ${filePath}`);
      });
      return 0;
    }

    if (toStdout) {
      const pdf = await compressStream(source, shared);
      await pipeline(pdf, process.stdout, { end: false });
      const ratio = ((1 - pdf.compressionRatio) * 100).toFixed(1);
      const originalKB = (pdf.originalSize / 1024).toFixed(1);
      const compressedKB = (pdf.compressedSize / 1024).toFixed(1);
      console.error(`✅ PDF compressed successfully!`);
      console.error(
        `   ${originalKB} KB → ${compressedKB} KB (${ratio}% smaller)`
      );
      console.error(`   Time: ${pdf.duration}ms`);
      console.error(`   Output: stdout`);
      return 0;
    }

    const result = await compress(source, { ...shared, output });

    const ratio = ((1 - result.compressionRatio) * 100).toFixed(1);
    const originalKB = (result.originalSize / 1024).toFixed(1);
    const compressedKB = (result.compressedSize / 1024).toFixed(1);

    console.log(`✅ PDF compressed successfully!`);
    console.log(`   ${originalKB} KB → ${compressedKB} KB (${ratio}% smaller)`);
    console.log(`   Time: ${result.duration}ms`);
    console.log(`   Output: ${result.output}`);
    return 0;
  } catch (error) {
    console.error(
      `❌ Compression failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}
