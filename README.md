# compress-pdf

This library provides compress your PDFs using ghostscript

## Installation

```sh
npm install compress-pdf
```

```sh
yarn add compress-pdf
```

### Code Usage

```tsx
import path from 'path';
import fs from 'fs';
import { compress } from 'compress-pdf';

(async () => {
  const pdf = path.resolve(__dirname, 'A17_FlightPlan.pdf');
  const buffer = await compress(pdf);

  const compressedPdf = path.resolve(__dirname, 'compressed_pdf.pdf');
  await fs.promises.writeFile(compressedPdf, buffer);
})();
```

## CLI Usage

```
npx compress-pdf --file [PDF_FILE] --output ./compressed.pdf

Options:
  --file [PDF_FILE] (REQUIRED)
  --output [COMPRESSED_PDF_FILE] (REQUIRED)
  --resolution [ebook/printer/screen/prepress]
  --compatibilityLevel [NUMBER] The compatibility pdf level
  --binPath [DIRECTORY] The directory of ghostscript binaries. Default is lib_folder/bin/gs
  --fetchBinaries [win32/linux] Download binaries to default binaries path
```

**You can see examples in [examples folder](https://github.com/victorsoares96/compress-pdf/tree/master/examples)**

## License

This project is under MIT license, see [LICENSE.md](https://github.com/victorsoares96/compress-pdf/blob/master/LICENSE) for details.
