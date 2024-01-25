import fs from 'fs';
import path from 'path';
import compress from '../src/compress';
import * as testHelper from './test.helper';

describe('compress', () => {
  it('should compress a pdf file', async () => {
    const originalFilePath = path.resolve(
      __dirname,
      '../examples/A17_FlightPlan.pdf'
    );

    const originalFile = await fs.promises.readFile(originalFilePath);
    const originalPDF = await testHelper.parsePDF(originalFilePath);

    const compressedFile = await compress(originalFilePath);
    const compressedPDF = await testHelper.parsePDF(compressedFile);

    expect(compressedFile.length).toBeLessThan(originalFile.length);
    expect(compressedPDF.numpages).toEqual(originalPDF.numpages);
    expect(compressedPDF.numrender).toEqual(originalPDF.numrender);
    expect(compressedPDF.text).toEqual(originalPDF.text);
  });
});
