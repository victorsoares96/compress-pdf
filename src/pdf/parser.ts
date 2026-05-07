import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { CompressPdfError } from '../types';

export interface SaveOptions {
  /**
   * When true, strips the /Encrypt reference from the trailer so the output
   * file has no encryption metadata.  Note: pdf-lib does not support
   * re-encrypting streams on save, so output is always unencrypted regardless
   * of this flag.
   */
  removePassword?: boolean;
}

// Standard PDF password padding string (PDF spec section 7.6.3.3)
const PDF_PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/**
 * Pure-JS RC4 encryption/decryption.
 * Required because Node.js with OpenSSL 3 has dropped RC4 support,
 * but the PDF password validation algorithm (R2–R4) depends on RC4.
 */
function rc4(key: Buffer, data: Buffer): Buffer {
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  let ii = 0;
  let jj = 0;
  return Buffer.from(
    Array.from(data).map((byte) => {
      ii = (ii + 1) & 0xff;
      jj = (jj + S[ii]) & 0xff;
      [S[ii], S[jj]] = [S[jj], S[ii]];
      return byte ^ S[(S[ii] + S[jj]) & 0xff];
    })
  );
}

interface PdfEncryptionInfo {
  isEncrypted: boolean;
  O?: Buffer;
  U?: Buffer;
  P?: number;
  R?: number;
  fileId?: Buffer;
  keyLen?: number;
}

/**
 * Parse the encryption dictionary from raw PDF bytes.
 *
 * PDF structure: the encryption dict values (O, U, P, R, Length) are
 * typically at the beginning of the file (in the first object), while
 * the /ID array lives in the trailer at the very end. We scan both ends
 * so large PDFs are handled without reading the full file into a string.
 *
 * Returns isEncrypted=false if no /Filter /Standard or /Encrypt marker
 * is found.
 */
function parsePdfEncryption(bytes: Buffer): PdfEncryptionInfo {
  const HEAD = 8192;
  const TAIL = 8192;
  const head = bytes.toString('latin1', 0, Math.min(bytes.length, HEAD));
  const tail =
    bytes.length > HEAD
      ? bytes.toString('latin1', Math.max(0, bytes.length - TAIL))
      : '';

  // /Filter /Standard in the first object is a reliable encryption marker.
  // /Encrypt in the trailer is another indicator (for cross-reference).
  const isEncrypted =
    /\/Filter\s*\/Standard/.test(head) || /\/Encrypt\b/.test(tail);

  if (!isEncrypted) {
    return { isEncrypted: false };
  }

  // Encryption dict values (O, U, P, R, Length) are in the head.
  // The file ID is in the trailer (/ID array).
  const combined = head + tail;

  const oMatch = combined.match(/\/O\s*<([0-9A-Fa-f]+)>/);
  const uMatch = combined.match(/\/U\s*<([0-9A-Fa-f]+)>/);
  const pMatch = combined.match(/\/P\s+(-?\d+)/);
  const rMatch = combined.match(/\/R\s+(\d+)/);
  const lenMatch = combined.match(/\/Length\s+(\d+)/);
  const idMatch = combined.match(/\/ID\s*\[?\s*<([0-9A-Fa-f]+)>/);

  if (!oMatch || !uMatch || !pMatch || !rMatch || !idMatch) {
    // Encrypted but can't parse the dict — surface as encrypted without validation
    return { isEncrypted: true };
  }

  return {
    isEncrypted: true,
    O: Buffer.from(oMatch[1], 'hex'),
    U: Buffer.from(uMatch[1], 'hex'),
    P: parseInt(pMatch[1], 10),
    R: parseInt(rMatch[1], 10),
    fileId: Buffer.from(idMatch[1], 'hex'),
    keyLen: lenMatch ? parseInt(lenMatch[1], 10) / 8 : 5,
  };
}

/**
 * Compute the PDF encryption key for a given password (PDF spec 7.6.3.3,
 * algorithm 2).
 */
function computeEncryptionKey(
  password: string,
  O: Buffer,
  P: number,
  fileId: Buffer,
  R: number,
  keyLen: number
): Buffer {
  const pw = Buffer.from(password, 'latin1');
  const paddedPw = Buffer.concat([pw, PDF_PAD]).slice(0, 32);

  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P);

  const md5Input = Buffer.concat([paddedPw, O, pBuf, fileId]);
  let hash = crypto.createHash('md5').update(md5Input).digest();

  if (R >= 3) {
    for (let i = 0; i < 50; i++) {
      hash = crypto.createHash('md5').update(hash.slice(0, keyLen)).digest();
    }
  }

  return hash.slice(0, keyLen);
}

/**
 * Validate a user password against the /U entry (PDF spec 7.6.3.4,
 * algorithm 6).  Supports R2–R4 (RC4/AES-128).
 */
function validateUserPassword(
  password: string,
  O: Buffer,
  U: Buffer,
  P: number,
  fileId: Buffer,
  R: number,
  keyLen: number
): boolean {
  const key = computeEncryptionKey(password, O, P, fileId, R, keyLen);

  if (R === 2) {
    const enc = rc4(key, PDF_PAD);
    return enc.equals(U);
  }

  // R >= 3: MD5(padding + fileId), then RC4-encrypt + 19 keyed iterations
  const md5Hash = crypto
    .createHash('md5')
    .update(Buffer.concat([PDF_PAD, fileId]))
    .digest();

  let enc = rc4(key, md5Hash);
  for (let i = 1; i <= 19; i++) {
    const xorKey = Buffer.alloc(keyLen);
    for (let j = 0; j < keyLen; j++) xorKey[j] = key[j] ^ i;
    enc = rc4(xorKey, enc);
  }

  return enc.slice(0, 16).equals(U.slice(0, 16));
}

/**
 * Load a PDF from raw bytes, optionally unlocking it with a password.
 *
 * For encrypted PDFs the password is validated with the standard PDF
 * algorithm (R2–R4, RC4/AES-128).  pdf-lib is then loaded with
 * `ignoreEncryption: true` so it can parse the page tree — actual stream
 * decryption is handled downstream by the compression pipeline.
 *
 * @throws {CompressPdfError} when the PDF is encrypted and no password is
 *   given, when the password is wrong, or when the bytes are not a valid PDF.
 */
export async function loadPdf(
  bytes: Buffer,
  password?: string
): Promise<PDFDocument> {
  const encInfo = parsePdfEncryption(bytes);

  if (encInfo.isEncrypted) {
    if (!password) {
      throw new CompressPdfError('PDF is encrypted, provide pdfPassword');
    }

    // Validate password when we have all the required dict fields
    if (
      encInfo.O &&
      encInfo.U &&
      encInfo.P !== undefined &&
      encInfo.R !== undefined &&
      encInfo.fileId &&
      encInfo.keyLen !== undefined
    ) {
      const valid = validateUserPassword(
        password,
        encInfo.O,
        encInfo.U,
        encInfo.P,
        encInfo.fileId,
        encInfo.R,
        encInfo.keyLen
      );
      if (!valid) {
        throw new CompressPdfError('Wrong password for encrypted PDF');
      }
    }

    // pdf-lib cannot decrypt streams, but can parse the page tree structure
    try {
      return await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new CompressPdfError(`Failed to parse PDF: ${msg}`, err);
    }
  }

  // Unencrypted PDF — load normally
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.toLowerCase().includes('encrypted') ||
      msg.toLowerCase().includes('password') ||
      msg.toLowerCase().includes('no password')
    ) {
      if (!password) {
        throw new CompressPdfError(
          'PDF is encrypted, provide pdfPassword',
          err
        );
      }
      throw new CompressPdfError('Wrong password for encrypted PDF', err);
    }

    throw new CompressPdfError(`Failed to parse PDF: ${msg}`, err);
  }
}

/**
 * Serialise a PDFDocument back to bytes.
 *
 * Note: pdf-lib does not support re-encrypting output — the saved file is
 * always unencrypted.  Pass `removePassword: true` to additionally strip the
 * /Encrypt reference from the trailer (removes the encryption marker).
 */
export async function savePdf(
  doc: PDFDocument,
  options?: SaveOptions
): Promise<Uint8Array> {
  if (options?.removePassword) {
    // Remove the /Encrypt reference from the PDF trailer so the saved file
    // has no encryption metadata.  pdf-lib carries the /Encrypt ref in
    // context.trailerInfo when it loaded an encrypted document with
    // ignoreEncryption:true; deleting it produces a clean, unprotected PDF.
    const ctx = (
      doc as unknown as { context: { trailerInfo: Record<string, unknown> } }
    ).context;
    if (ctx?.trailerInfo?.Encrypt !== undefined) {
      delete ctx.trailerInfo.Encrypt;
    }
    return doc.save();
  }

  return doc.save();
}
