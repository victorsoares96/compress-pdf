import path from 'path';
import fs from 'fs';
import compressPdf from '@/index';

/**
 * Before run:
 *
 * `npx compress-pdf --fetchBinaries [win32/linux]`
 * This will download properly binaries to your current os.
 */

(async () => {
  const pdf = path.resolve(__dirname, 'A17_FlightPlan.pdf');
  const buffer = await compressPdf(pdf);

  const compressedPdf = path.resolve(__dirname, 'compressed_pdf.pdf');
  await fs.promises.writeFile(compressedPdf, buffer);
})();
