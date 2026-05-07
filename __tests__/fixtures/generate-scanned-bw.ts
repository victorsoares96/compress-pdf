// __tests__/fixtures/generate-scanned-bw.ts
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict } from 'pdf-lib';

const COLUMNS = 2550; // 300 DPI × 8.5"
const ROWS = 3300;    // 300 DPI × 11"

function buildCCITTG4Stream(): Uint8Array {
  // 3300 all-white rows in CCITT G4 vs all-white reference:
  //   each row = V(0) code = 1 bit → 3300 bits total
  // EOFB = two 12-bit EOLs (000000000001 × 2) = 24 bits
  // Total: 3324 bits → 416 bytes (4 padding bits)
  const stream = new Uint8Array(416);
  stream.fill(0xFF, 0, 412); // 3296 V(0) bits = 412 bytes
  stream[412] = 0xF0; // 4 more V(0): 1111, then EOFB starts: 0000
  stream[413] = 0x01; // EOFB EOL-1 bits 4–11: 0000 0001
  stream[414] = 0x00; // EOFB EOL-2 bits 0–7:  0000 0000
  stream[415] = 0x10; // EOFB EOL-2 bits 8–11: 0001, padding: 0000
  return stream;
}

async function main(): Promise<void> {
  const ccittData = buildCCITTG4Stream();
  const doc = await PDFDocument.create();
  const { context } = doc;

  const decodeParms = context.obj({
    K: PDFNumber.of(-1),
    Columns: PDFNumber.of(COLUMNS),
    Rows: PDFNumber.of(ROWS),
  }) as PDFDict;

  const imageDict = context.obj({
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Image'),
    Width: PDFNumber.of(COLUMNS),
    Height: PDFNumber.of(ROWS),
    ColorSpace: PDFName.of('DeviceGray'),
    BitsPerComponent: PDFNumber.of(1),
    Filter: PDFName.of('CCITTFaxDecode'),
    DecodeParms: decodeParms,
    Length: PDFNumber.of(ccittData.length),
  }) as PDFDict;

  const imageRef = context.register(PDFRawStream.of(imageDict, ccittData));

  const page = doc.addPage([612, 792]);
  const { node } = page;

  // Wire XObject resource
  let resources = node.Resources();
  if (!resources) {
    resources = context.obj({}) as PDFDict;
    node.set(PDFName.of('Resources'), resources);
  }
  const xObjects = context.obj({ Img: imageRef }) as PDFDict;
  (resources as PDFDict).set(PDFName.of('XObject'), xObjects);

  // Content stream: scale to fill page and draw image
  const ops = Buffer.from('q 612 0 0 792 0 0 cm /Img Do Q');
  const contentDict = context.obj({ Length: PDFNumber.of(ops.length) }) as PDFDict;
  const contentRef = context.register(PDFRawStream.of(contentDict, new Uint8Array(ops)));
  node.set(PDFName.of('Contents'), contentRef);

  // useObjectStreams:false avoids ObjStm-based cross-references which cause
  // pdf-lib to lose the catalog Root reference after compress() round-trips
  // the document through loadPdf → optimizeFlateStream → savePdf.
  const pdfBytes = await doc.save({ useObjectStreams: false });
  const outPath = join(__dirname, 'scanned-bw.pdf');
  writeFileSync(outPath, pdfBytes);
  console.log(`Written: ${outPath} (${pdfBytes.length} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
