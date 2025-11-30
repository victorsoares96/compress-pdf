/**
 * This example demonstrates that compress-pdf now works out of the box
 * without requiring manual Ghostscript installation!
 *
 * The binaries are automatically downloaded during npm install.
 */

import path from 'path';
import fs from 'fs';
import { compress } from '../src';

async function testAutoInstall() {
  console.log('🧪 Testing automatic binary installation...\n');

  // The library will automatically use the downloaded binaries
  const inputPdf = path.resolve(__dirname, 'A17_FlightPlan.pdf');

  if (!fs.existsSync(inputPdf)) {
    console.log(
      '⚠️  Test PDF not found. Please ensure A17_FlightPlan.pdf exists in the examples folder.'
    );
    return;
  }

  try {
    console.log('📄 Compressing PDF...');
    const buffer = await compress(inputPdf, {
      resolution: 'ebook',
      imageQuality: 100,
    });

    const outputPdf = path.resolve(__dirname, 'compressed_auto_install.pdf');
    await fs.promises.writeFile(outputPdf, buffer);

    const inputSize = fs.statSync(inputPdf).size;
    const outputSize = buffer.length;
    const reduction = ((1 - outputSize / inputSize) * 100).toFixed(2);

    console.log('✅ Compression successful!');
    console.log(`📊 Original size: ${(inputSize / 1024).toFixed(2)} KB`);
    console.log(`📊 Compressed size: ${(outputSize / 1024).toFixed(2)} KB`);
    console.log(`📊 Size reduction: ${reduction}%`);
    console.log(`📁 Output: ${outputPdf}`);
    console.log(
      '\n🎉 The library is working with automatically downloaded binaries!'
    );
  } catch (error) {
    console.error('❌ Error:', error);
    console.log(
      '\n💡 Tip: You can set COMPRESS_PDF_BIN_PATH to use a custom Ghostscript binary'
    );
  }
}

testAutoInstall();
