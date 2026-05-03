# compress-pdf

This library provides compress your PDFs using ghostscript

## Installation

```sh
npm install compress-pdf
```

```sh
yarn add compress-pdf
```

### Automatic Binary Installation

Starting from version 0.6.0, **Ghostscript binaries are automatically downloaded and installed** during `npm install`, similar to how Puppeteer handles browser downloads. This means you can use the library right away without any additional setup! 🎉

The installation script will:

- Detect your operating system (Windows, macOS, or Linux)
- Download the appropriate Ghostscript binaries
- Extract them to the `bin/gs` folder within the package
- Set proper executable permissions (on Unix-like systems)

### Environment Variables

You can control the binary installation behavior using environment variables:

- **`COMPRESS_PDF_SKIP_DOWNLOAD=true`**: Skip automatic binary download during installation
- **`COMPRESS_PDF_BIN_PATH=/path/to/gs`**: Use a custom Ghostscript binary path

### Manual Installation (Optional)

If you prefer to use system-installed Ghostscript or the automatic download fails, you can install Ghostscript manually:

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

**Option 1: Using Automatic Binary Download (Recommended)**

```dockerfile
FROM node:18 AS build
WORKDIR /src
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build

FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm i
COPY --from=build /src/build /app/build/
EXPOSE 8080
CMD [ "npm", "start" ]
```

**Option 2: Using System Ghostscript**

If you prefer to use system-installed Ghostscript, you can skip the automatic download:

```dockerfile
FROM node:18 AS build
WORKDIR /src
COPY package*.json ./
RUN COMPRESS_PDF_SKIP_DOWNLOAD=true npm i
COPY . .
RUN npm run build

FROM node:18
WORKDIR /app
RUN apt-get update \
    && apt-get install -y ghostscript
COPY package*.json ./
RUN COMPRESS_PDF_SKIP_DOWNLOAD=true npm i
COPY --from=build /src/build /app/build/
EXPOSE 8080
CMD [ "npm", "start" ]
```

**You can see examples in [examples folder](https://github.com/victorsoares96/compress-pdf/tree/master/examples)**

## License

This project is under MIT license, see [LICENSE.md](https://github.com/victorsoares96/compress-pdf/blob/master/LICENSE) for details.
