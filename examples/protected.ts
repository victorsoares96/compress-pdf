import path from 'path';
import fs from 'fs';
import { compress } from 'compress-pdf';

(async () => {
  const inputPath = path.resolve(__dirname, 'A17_FlightPlan-protected.pdf');

  // Compress keeping the same password
  const withPassword = await compress(inputPath, {
    pdfPassword: 'a17',
  });
  await fs.promises.writeFile(
    path.resolve(__dirname, 'compressed-protected.pdf'),
    withPassword
  );
  console.log('Compressed (password kept)');

  // Compress and remove the password
  const withoutPassword = await compress(inputPath, {
    pdfPassword: 'a17',
    removePasswordAfterCompression: true,
  });
  await fs.promises.writeFile(
    path.resolve(__dirname, 'compressed-unlocked.pdf'),
    withoutPassword
  );
  console.log('Compressed (password removed)');
})();
