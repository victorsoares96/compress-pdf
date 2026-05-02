import path from 'path';
import fs from 'fs';
import { compress } from 'compress-pdf';

const inputPath = path.resolve(__dirname, 'A17_FlightPlan.pdf');

async function compressWithPreset(
  resolution: 'screen' | 'ebook' | 'printer' | 'prepress',
  outputName: string
) {
  const result = await compress(inputPath, { resolution });
  await fs.promises.writeFile(path.resolve(__dirname, outputName), result);
  const saved = ((1 - result.compressionRatio) * 100).toFixed(1);
  console.log(
    `[${resolution}] ${(result.compressedSize / 1024).toFixed(1)} KB — ${saved}% smaller`
  );
}

(async () => {
  console.log('Compressing with all presets...\n');
  await compressWithPreset('screen', 'out-screen.pdf');
  await compressWithPreset('ebook', 'out-ebook.pdf');
  await compressWithPreset('printer', 'out-printer.pdf');
  await compressWithPreset('prepress', 'out-prepress.pdf');
})();
