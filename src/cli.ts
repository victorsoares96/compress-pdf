/* eslint-disable no-console */
import { parseArgs } from 'node:util';
import { pipeline } from 'node:stream/promises';
import fs from 'fs';
import path from 'path';
import compress, { compressStream } from '@/compress';
import split from '@/split';
import {
  VALID_RESOLUTIONS,
  type Options,
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
  --batch <directory>        Compress each PDF in that folder, without joining.
                             -o must be a different directory. Not with --file
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
  npx compress-pdf --batch ./scans -o ./out
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
  batch: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

function parseCliArgs(userArgs: readonly string[]) {
  return parseArgs({
    args: [...userArgs],
    options: cliOptions,
    strict: true,
  });
}

function isPdfFile(directory: string, name: string): boolean {
  if (!name.toLowerCase().endsWith('.pdf')) {
    return false;
  }
  const full = path.join(directory, name);
  return fs.existsSync(full) && fs.statSync(full).isFile();
}

function optionError(input: {
  resolution?: string;
  pdfa?: string;
  pagesText?: string;
}): string | undefined {
  if (input.pagesText !== undefined) {
    try {
      parsePages(input.pagesText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}\n\n${helpText}`;
    }
  }

  if (input.pdfa !== undefined && !isPdfaLevel(input.pdfa)) {
    return `Error: Invalid pdfa "${input.pdfa}". Must be one of: 1b, 2b, 3b`;
  }

  if (
    input.resolution &&
    input.resolution !== 'auto' &&
    !VALID_RESOLUTIONS.includes(
      input.resolution as (typeof VALID_RESOLUTIONS)[number]
    )
  ) {
    return `Error: Invalid resolution "${input.resolution}". Must be one of: ${VALID_RESOLUTIONS.join(', ')}, auto`;
  }

  return undefined;
}

function commandOptions(input: {
  resolution?: string;
  compatibilityLevel?: string;
  pdfa?: string;
  imageQuality?: string;
  gsModule?: string;
  pdfPassword?: string;
  removePasswordAfterCompression: boolean;
  returnOriginalIfLarger: boolean;
  targetSize?: string;
  stripMetadata: boolean;
  sanitize: boolean;
  setMetadata?: PdfMetadata;
  pagesText?: string;
}): Options {
  return {
    resolution: input.resolution
      ? (input.resolution as ResolutionSetting)
      : undefined,
    compatibilityLevel: input.compatibilityLevel
      ? Number(input.compatibilityLevel)
      : undefined,
    pdfa: input.pdfa as PdfaLevel | undefined,
    imageQuality: input.imageQuality ? Number(input.imageQuality) : undefined,
    gsModule: input.gsModule,
    pdfPassword: input.pdfPassword,
    removePasswordAfterCompression: input.removePasswordAfterCompression,
    returnOriginalIfLarger: input.returnOriginalIfLarger,
    targetSize: input.targetSize ? Number(input.targetSize) : undefined,
    stripMetadata: input.stripMetadata,
    sanitize: input.sanitize,
    setMetadata: input.setMetadata,
    ...(input.pagesText !== undefined ? { pages: input.pagesText } : {}),
  };
}

function batchUsage(message: string): number {
  console.error(`${message}\n\nRun with --help for usage information.`);
  return 1;
}

async function runBatch(
  directory: string,
  output: string,
  options: Options
): Promise<number> {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return batchUsage(`Error: --batch must be a directory, got ${directory}`);
  }

  if (fs.existsSync(output) && !fs.statSync(output).isDirectory()) {
    return batchUsage(
      `Error: --output must be a directory when using --batch, got ${output}`
    );
  }

  if (
    fs.existsSync(output) &&
    fs.realpathSync(directory) === fs.realpathSync(output)
  ) {
    return batchUsage(
      'Error: --output must be a different directory from --batch'
    );
  }

  const names = fs
    .readdirSync(directory)
    .filter((name) => isPdfFile(directory, name))
    .sort();
  if (names.length === 0) {
    return batchUsage(`Error: no PDF files found in ${directory}`);
  }

  fs.mkdirSync(output, { recursive: true });

  let failed = false;
  let index = 0;
  // One Ghostscript run per file. A failure is reported and the rest continue.
  /* eslint-disable no-await-in-loop */
  while (index < names.length) {
    const name = names[index];
    index += 1;
    try {
      const result = await compress(path.join(directory, name), {
        ...options,
        output: path.join(output, name),
      });
      const ratio = ((1 - result.compressionRatio) * 100).toFixed(1);
      const originalKB = (result.originalSize / 1024).toFixed(1);
      const compressedKB = (result.compressedSize / 1024).toFixed(1);
      console.log(
        `✅ ${name}: ${originalKB} KB → ${compressedKB} KB (${ratio}% smaller)`
      );
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${name}: ${message}`);
    }
  }
  /* eslint-enable no-await-in-loop */

  return failed ? 1 : 0;
}

async function startBatch(input: {
  directory: string;
  files: string[];
  output?: string;
  resolution?: string;
  pdfa?: string;
  pagesText?: string;
  options: Options;
}): Promise<number> {
  if (input.files.length > 0) {
    return batchUsage('Error: --batch cannot be used with --file');
  }
  if (input.output === undefined) {
    return batchUsage('Error: --output is required with --batch');
  }
  if (input.output === '-') {
    return batchUsage('Error: --batch cannot write to stdout');
  }
  if (input.output.includes('%d')) {
    return batchUsage('Error: --batch cannot be used with %d');
  }

  const invalid = optionError({
    resolution: input.resolution,
    pdfa: input.pdfa,
    pagesText: input.pagesText,
  });
  if (invalid) {
    console.error(invalid);
    return 1;
  }

  return runBatch(input.directory, input.output, input.options);
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
  const batch = getStringValue(values.batch);
  const options = commandOptions({
    resolution,
    compatibilityLevel,
    pdfa,
    imageQuality,
    gsModule,
    pdfPassword,
    removePasswordAfterCompression:
      values.removePasswordAfterCompression as boolean,
    returnOriginalIfLarger: values.returnOriginalIfLarger as boolean,
    targetSize,
    stripMetadata: values.stripMetadata as boolean,
    sanitize: values.sanitize as boolean,
    setMetadata: metadataFromFlags(values),
    pagesText,
  });

  if (batch !== undefined) {
    return startBatch({
      directory: batch,
      files,
      output,
      resolution,
      pdfa,
      pagesText,
      options,
    });
  }

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

  const invalid = optionError({ resolution, pdfa, pagesText });
  if (invalid) {
    console.error(invalid);
    return 1;
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

  const shared = {
    ...options,
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
