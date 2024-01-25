# compress-pdf

This library provides compress your PDFs using ghostscript

### 🚨 Breaking Change 🚨

From now on it is no longer possible to use the `--fetchBinaries` flag, the binaries must be obtained through the **Install binaries** step by step of this readme

## Installation

```sh
npm install compress-pdf
```

```sh
yarn add compress-pdf
```

### Install binaries

**Ubuntu**

```sh
sudo apt-get install ghostscript -y
```

**MacOS**

```sh
brew install ghostscript
```

**Windows (Chocolatey)**

```sh
choco install ghostscript
```
or [download](https://ghostscript.com/releases/gsdnld.html) Ghostscript `.exe` installer

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

### CLI Usage

```
npx compress-pdf --file [PDF_FILE] --output ./compressed.pdf

Options:
  --file [PDF_FILE] (REQUIRED)
  --output [COMPRESSED_PDF_FILE] (REQUIRED)
  --resolution [ebook/printer/screen/prepress]
  --compatibilityLevel [NUMBER] The compatibility pdf level
  --gsModule [FILE PATH] The directory of ghostscript binaries. Ex: /usr/bin/gs
  --pdfPassword The pdf password
  --removePasswordAfterCompression [BOOLEAN] Remove pdf password after compression
```

### Usage with Docker

```dockerfile
FROM node:18 AS build
WORKDIR /src
COPY package*.json ./
RUN npm pkg set scripts.scriptname="true" && npm i
COPY . .
RUN npm run build

FROM node:18
WORKDIR /app
RUN apt-get update \
    && apt-get install -y ghostscript
COPY package*.json ./
RUN npm pkg set scripts.scriptname="true" && npm i
COPY --from=build /src/build /app/build/
EXPOSE 8080
CMD [ "npm", "start" ]
```

**OBS:** This is just an example of how to use this lib in a docker image, note that you need to run apt-get to install ghostscript before doing anything

**You can see examples in [examples folder](https://github.com/victorsoares96/compress-pdf/tree/master/examples)**

## License

This project is under MIT license, see [LICENSE.md](https://github.com/victorsoares96/compress-pdf/blob/master/LICENSE) for details.
