import path from 'path';
import fs from 'fs';
import { compress } from '@/index';

(async () => {
  const pdf = path.resolve(__dirname, 'A17_FlightPlan-protected.pdf');
  const buffer = await compress(pdf, { pdfPassword: 'a17' });

  const compressedPdf = path.resolve(__dirname, 'compressed_protected_pdf.pdf');
  await fs.promises.writeFile(compressedPdf, buffer);
})();
