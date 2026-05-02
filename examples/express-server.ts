/**
 * Express endpoint that compresses an uploaded PDF and returns it.
 *
 * Dependencies: express, multer
 *   npm install express multer
 *   npm install -D @types/express @types/multer
 */
import express from 'express';
import multer from 'multer';
import { compress, CompressPdfError } from 'compress-pdf';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/compress', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
    return;
  }

  const resolution = (req.query.resolution as string) || 'ebook';
  const jpegQuality = req.query.jpegQuality
    ? Number(req.query.jpegQuality)
    : undefined;
  const imageDpi = req.query.imageDpi ? Number(req.query.imageDpi) : undefined;

  try {
    const result = await compress(req.file.buffer, {
      resolution: resolution as any,
      jpegQuality,
      imageDpi,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="compressed.pdf"',
      'X-Original-Size': String(result.originalSize),
      'X-Compressed-Size': String(result.compressedSize),
      'X-Compression-Ratio': String(result.compressionRatio),
    });

    res.send(result);
  } catch (err) {
    if (err instanceof CompressPdfError) {
      res.status(422).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Unexpected error' });
    }
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
