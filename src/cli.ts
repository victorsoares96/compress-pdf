/* eslint-disable no-console */
import { parseArgs } from 'node:util';
import fs from 'fs';
import compress from '@/compress';
import type { Resolution } from './types';

const helpText = `
compress-pdf - Compress PDF files (pure JS, no external dependencies)

Usage:
  npx compress-pdf --file <input> --output <output> [options]

Required:
  -f, --file <path>          Path to the PDF file to compress
  -o, --output <path>        Path to save the compressed PDF

Options:
  -r, --resolution <preset>  Compression preset: screen | ebook | printer | prepress | default
                             (default: ebook)
  --imageDpi <n>             Target image DPI, 1-600 (overrides preset)
  --jpegQuality <n>          JPEG quality, 0-100 (overrides preset)
  --pdfPassword <pass>       Password for protected PDFs
  --removePasswordAfterCompression
                             Strip password protection from output
  -h, --help                 Show this help message

Presets:
  screen   — 72 DPI, quality 35  (smallest file, screen viewing only)
  ebook    — 150 DPI, quality 65 (default, good balance)
  printer  — 300 DPI, quality 85 (high quality, larger file)
  prepress — 300 DPI, quality 95 (near lossless, largest file)

Examples:
  npx compress-pdf -f input.pdf -o output.pdf
  npx compress-pdf -f input.pdf -o output.pdf -r screen
  npx compress-pdf -f input.pdf -o output.pdf --imageDpi 72 --jpegQuality 50
  npx compress-pdf -f protected.pdf -o output.pdf --pdfPassword mypass
  npx compress-pdf -f protected.pdf -o output.pdf --pdfPassword mypass --removePasswordAfterCompression
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
      imageDpi: { type: 'string' },
      jpegQuality: { type: 'string' },
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
  const imageDpi = getStringValue(values.imageDpi);
  const jpegQuality = getStringValue(values.jpegQuality);
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
      imageDpi: imageDpi ? Number(imageDpi) : undefined,
      jpegQuality: jpegQuality ? Number(jpegQuality) : undefined,
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
