import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { loadPdf, savePdf } from '../src/pdf/parser';
import { CompressPdfError } from '../src/types';

const FLIGHT_PLAN = path.resolve(__dirname, '../examples/A17_FlightPlan.pdf');
const PROTECTED   = path.resolve(__dirname, '../examples/A17_FlightPlan-protected.pdf');

describe('loadPdf', () => {
  it('loads a valid PDF and returns PDFDocument', async () => {
    const bytes = await fs.promises.readFile(FLIGHT_PLAN);
    const doc = await loadPdf(bytes);
    expect(doc).toBeDefined();
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('loads a password-protected PDF with correct password', async () => {
    const bytes = await fs.promises.readFile(PROTECTED);
    const doc = await loadPdf(bytes, 'a17');
    expect(doc).toBeDefined();
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it('throws CompressPdfError for encrypted PDF without password', async () => {
    const bytes = await fs.promises.readFile(PROTECTED);
    await expect(loadPdf(bytes)).rejects.toThrow(CompressPdfError);
  });

  it('throws CompressPdfError for wrong password', async () => {
    const bytes = await fs.promises.readFile(PROTECTED);
    await expect(loadPdf(bytes, 'wrongpass')).rejects.toThrow(CompressPdfError);
  });

  it('throws CompressPdfError for invalid PDF bytes', async () => {
    const garbage = Buffer.from('not a pdf at all');
    await expect(loadPdf(garbage)).rejects.toThrow(CompressPdfError);
  });
}, { timeout: 30000 });

describe('savePdf', () => {
  it('saves a PDF and returns Uint8Array starting with %PDF', async () => {
    const bytes = await fs.promises.readFile(FLIGHT_PLAN);
    const doc = await loadPdf(bytes);
    const saved = await savePdf(doc);
    expect(saved).toBeInstanceOf(Uint8Array);
    expect(saved.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...saved.slice(0, 4))).toBe('%PDF');
  });

  it('saves without password when removePassword is true', async () => {
    const bytes = await fs.promises.readFile(PROTECTED);
    const doc = await loadPdf(bytes, 'a17');
    const saved = await savePdf(doc, { removePassword: true });
    const reloaded = await loadPdf(Buffer.from(saved));
    expect(reloaded.getPageCount()).toBeGreaterThan(0);
  });

  it('saves with password when removePassword is false', async () => {
    const bytes = await fs.promises.readFile(PROTECTED);
    const doc = await loadPdf(bytes, 'a17');
    const saved = await savePdf(doc, { password: 'a17', removePassword: false });
    await expect(loadPdf(Buffer.from(saved))).rejects.toThrow(CompressPdfError);
    const reloaded = await loadPdf(Buffer.from(saved), 'a17');
    expect(reloaded.getPageCount()).toBeGreaterThan(0);
  });
}, { timeout: 30000 });
