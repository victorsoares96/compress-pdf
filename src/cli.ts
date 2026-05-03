/* eslint-disable no-console */
import { parseArgs } from 'node:util';
import fs from 'fs';
import compress from '@/compress';
import type { Resolution } from './types';

const helpText = `
compress-pdf - Compress PDF files using Ghostscript

Usage:
  npx compress-pdf --file <input> --output <output> [options]

Required:
  -f, --file <path>          Path to the PDF file to compress
  -o, --output <path>        Path to save the compressed PDF

Options:
  -r, --resolution <preset>  Compression preset: screen | ebook | printer | prepress | default
                             (default: ebook)
  --compatibilityLevel <n>   PDF compatibility level (default: 1.4)
  --imageQuality <n>         Image resolution/quality in DPI, 1-600 (default: 100)
  --gsModule <path>          Custom Ghostscript binary path
  --pdfPassword <pass>       Password for protected PDFs
  --removePasswordAfterCompression
                             Remove password protection after compression
  -h, --help                 Show this help message

Examples:
  npx compress-pdf -f input.pdf -o output.pdf
  npx compress-pdf -f input.pdf -o output.pdf -r screen
  npx compress-pdf -f input.pdf -o output.pdf --imageQuality 72
  npx compress-pdf -f protected.pdf -o output.pdf --pdfPassword mypass
`;

function getStringValue(
  value: string | boolean | undefined
): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

(async () => {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      output: { type: 'string', short: 'o' },
      resolution: { type: 'string', short: 'r' },
      compatibilityLevel: { type: 'string' },
      imageQuality: { type: 'string' },
      gsModule: { type: 'string' },
      pdfPassword: { type: 'string' },
      removePasswordAfterCompression: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: false,
  });

  if (values.help || process.argv.slice(2).length === 0) {
    console.log(helpText);
    process.exit(0);
  }

  const file = getStringValue(values.file);
  const output = getStringValue(values.output);
  const resolution = getStringValue(values.resolution);
  const compatibilityLevel = getStringValue(values.compatibilityLevel);
  const imageQuality = getStringValue(values.imageQuality);
  const gsModule = getStringValue(values.gsModule);
  const pdfPassword = getStringValue(values.pdfPassword);

  if (!file || !output) {
    console.error(
      'Error: --file and --output are required.\n\nRun with --help for usage information.'
    );
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  try {
    const result = await compress(file, {
      resolution: resolution ? (resolution as Resolution) : undefined,
      compatibilityLevel: compatibilityLevel
        ? Number(compatibilityLevel)
        : undefined,
      imageQuality: imageQuality ? Number(imageQuality) : undefined,
      gsModule,
      pdfPassword,
      removePasswordAfterCompression:
        values.removePasswordAfterCompression as boolean,
    });

    fs.writeFileSync(output, result);

    const ratio = ((1 - result.compressionRatio) * 100).toFixed(1);
    const originalKB = (result.originalSize / 1024).toFixed(1);
    const compressedKB = (result.compressedSize / 1024).toFixed(1);

    console.log(`✅ PDF compressed successfully!`);
    console.log(`   ${originalKB} KB → ${compressedKB} KB (${ratio}% smaller)`);
    console.log(`   Time: ${result.duration}ms`);
    console.log(`   Output: ${output}`);
  } catch (error) {
    console.error(
      `❌ Compression failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
})();
