import path from 'path';
import fs from 'fs';
import { compress } from 'compress-pdf';

(async () => {
  const inputPath = path.resolve(__dirname, 'A17_FlightPlan.pdf');
  const outputPath = path.resolve(__dirname, 'compressed.pdf');

  const result = await compress(inputPath);

  await fs.promises.writeFile(outputPath, result);

  const saved = ((1 - result.compressionRatio) * 100).toFixed(1);
  console.log(`Original:   ${(result.originalSize / 1024).toFixed(1)} KB`);
  console.log(`Compressed: ${(result.compressedSize / 1024).toFixed(1)} KB`);
  console.log(`Saved:      ${saved}%`);
  console.log(`Time:       ${result.duration}ms`);
})();
