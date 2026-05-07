import fs from 'fs';
import path from 'path';
import os from 'os';
import { PDFDocument, PDFRawStream, PDFName, PDFNumber } from 'pdf-lib';
import compress from '../src/compress';
import { CompressPdfError } from '../src/types';

// Existing test fixture PDFs
const FLIGHT_PLAN = path.resolve(__dirname, '../examples/A17_FlightPlan.pdf');
const PROTECTED = path.resolve(__dirname, '../examples/A17_FlightPlan-protected.pdf');
const PROTECTED_PASSWORD = 'a17';

let simplePdfBuffer: Buffer;
let tempFilePath: string;

/**
 * Create a minimal PDF (no images) for basic tests.
 */
async function createSimplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('Simple test PDF');
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

beforeAll(async () => {
  simplePdfBuffer = await createSimplePdf();

  // Write a temp PDF file for path-based test
  tempFilePath = path.join(os.tmpdir(), `compress-test-${Date.now()}.pdf`);
  await fs.promises.writeFile(tempFilePath, simplePdfBuffer);
}, 30000);

afterAll(async () => {
  try {
    await fs.promises.unlink(tempFilePath);
  } catch {
    // ignore
  }
});

describe('compress', () => {
  // Test 1: compress a Buffer, returns CompressResult metadata
  it('compresses a Buffer and returns CompressResult metadata', async () => {
    const result = await compress(simplePdfBuffer);

    expect(result).toBeInstanceOf(Buffer);
    expect(typeof result.originalSize).toBe('number');
    expect(typeof result.compressedSize).toBe('number');
    expect(typeof result.compressionRatio).toBe('number');
    expect(typeof result.duration).toBe('number');

    expect(result.originalSize).toBe(simplePdfBuffer.length);
    expect(result.compressedSize).toBe(result.length);
    expect(result.compressionRatio).toBeCloseTo(result.compressedSize / result.originalSize, 10);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  }, 30000);

  // Test 2: compress from file path (string)
  it('compresses from a file path string', async () => {
    const result = await compress(tempFilePath);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.originalSize).toBe(simplePdfBuffer.length);
    expect(result.compressedSize).toBe(result.length);
  }, 30000);

  // Test 3: resolution preset affects output (screen < printer sizes for JPEG-heavy PDF)
  it('resolution preset affects output size: screen produces smaller file than printer', async () => {
    const pdfBytes = await fs.promises.readFile(FLIGHT_PLAN);

    const [screenResult, printerResult] = await Promise.all([
      compress(pdfBytes, { resolution: 'screen' }),
      compress(pdfBytes, { resolution: 'printer' }),
    ]);

    // screen (72dpi, quality 35) should produce smaller output than printer (300dpi, quality 85)
    // Both should produce valid PDFs
    expect(screenResult).toBeInstanceOf(Buffer);
    expect(printerResult).toBeInstanceOf(Buffer);
    expect(screenResult.length).toBeLessThanOrEqual(printerResult.length);
  }, 60000);

  // Test 4: invalid imageDpi throws CompressPdfError
  it('throws CompressPdfError for imageDpi out of range (too low: 0)', async () => {
    await expect(compress(simplePdfBuffer, { imageDpi: 0 })).rejects.toThrow(CompressPdfError);
  });

  it('throws CompressPdfError for imageDpi out of range (too high: 601)', async () => {
    await expect(compress(simplePdfBuffer, { imageDpi: 601 })).rejects.toThrow(CompressPdfError);
  });

  // Test 5: invalid jpegQuality throws CompressPdfError
  it('throws CompressPdfError for jpegQuality out of range (negative: -1)', async () => {
    await expect(compress(simplePdfBuffer, { jpegQuality: -1 })).rejects.toThrow(CompressPdfError);
  });

  it('throws CompressPdfError for jpegQuality out of range (above 100: 101)', async () => {
    await expect(compress(simplePdfBuffer, { jpegQuality: 101 })).rejects.toThrow(CompressPdfError);
  });

  // Test 6: encrypted PDF without password throws CompressPdfError
  it('throws CompressPdfError for encrypted PDF without password', async () => {
    const encryptedBytes = await fs.promises.readFile(PROTECTED);
    await expect(compress(encryptedBytes)).rejects.toThrow(CompressPdfError);
  }, 30000);

  // Test 7: encrypted PDF with wrong password throws CompressPdfError
  it('throws CompressPdfError for encrypted PDF with wrong password', async () => {
    const encryptedBytes = await fs.promises.readFile(PROTECTED);
    await expect(
      compress(encryptedBytes, { pdfPassword: 'wrongpassword' })
    ).rejects.toThrow(CompressPdfError);
  }, 30000);

  // Test 8: encrypted PDF with correct password compresses successfully
  it('compresses encrypted PDF with correct password', async () => {
    const encryptedBytes = await fs.promises.readFile(PROTECTED);
    const result = await compress(encryptedBytes, { pdfPassword: PROTECTED_PASSWORD });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.originalSize).toBe(encryptedBytes.length);
  }, 60000);

  // Test 9: removePasswordAfterCompression=true strips /Encrypt from output
  // NOTE: pdf-lib loads encrypted PDFs with ignoreEncryption:true — stream bytes remain
  // encrypted binary. We can strip the /Encrypt trailer entry but cannot decrypt streams.
  // The output is therefore NOT re-loadable by pdf-lib, but the /Encrypt marker IS removed.
  it('removePasswordAfterCompression=true strips /Encrypt marker from output', async () => {
    const encryptedBytes = await fs.promises.readFile(PROTECTED);
    const result = await compress(encryptedBytes, {
      pdfPassword: PROTECTED_PASSWORD,
      removePasswordAfterCompression: true,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.originalSize).toBe(encryptedBytes.length);

    // The /Encrypt cross-reference should be removed from the trailer.
    // We check the tail of the file (trailer lives at the end).
    const tail = result.slice(-4096).toString('latin1');
    expect(tail).not.toMatch(/\/Encrypt\b/);
  }, 60000);

  // Test 10: CCITTFaxDecode streams converted to FlateDecode
  it('converts CCITTFaxDecode image streams to FlateDecode and reduces file size', async () => {
    const SCANNED_BW = path.resolve(__dirname, 'fixtures/scanned-bw.pdf');
    const input = await fs.promises.readFile(SCANNED_BW);

    const result = await compress(input, { resolution: 'ebook' });

    expect(result).toBeInstanceOf(Buffer);

    // All CCITTFaxDecode streams must be converted to FlateDecode in output
    const outDoc = await PDFDocument.load(result);
    const inDoc = await PDFDocument.load(input);
    expect(outDoc.getPageCount()).toBe(inDoc.getPageCount());
    for (const [, obj] of outDoc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const filter = obj.dict.get(PDFName.of('Filter'));
      if (filter) expect(filter.toString()).not.toBe('/CCITTFaxDecode');
    }

    // Overall file must be smaller than input
    expect(result.compressionRatio).toBeLessThan(1.0);
  }, 30000);
});
