# compress-pdf

Compress PDF files with Ghostscript. Requires Node.js 20 or newer.

## Installation

```sh
npm install compress-pdf
```

```sh
yarn add compress-pdf
```

### Automatic Binary Installation

Starting from version 0.6.0, **Ghostscript binaries are automatically downloaded and installed** during `npm install`, similar to how Puppeteer handles browser downloads. This means you can use the library right away without any additional setup.

The installation script will:

- Detect your operating system (Windows, macOS, or Linux)
- Download the appropriate Ghostscript binaries
- Extract them to the `bin/gs` folder within the package
- Set proper executable permissions (on Unix-like systems)

### Environment Variables

- **`COMPRESS_PDF_SKIP_DOWNLOAD=true`**: Skip automatic binary download during installation
- **`COMPRESS_PDF_BIN_PATH=/path/to/gs`**: Use a custom Ghostscript binary
- **`COMPRESS_PDF_PASSWORD`**: PDF password when `pdfPassword` or `--pdfPassword` is omitted. The CLI flag is stored in shell history, so prefer the environment variable. If both are set, the flag wins.

### Manual Installation (Optional)

If you prefer to use system-installed Ghostscript or the automatic download fails, you can install Ghostscript manually and point `COMPRESS_PDF_BIN_PATH` at the `gs` binary:

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

`compress()` returns a `Buffer`. You can also read:

- `originalSize` and `compressedSize`, in bytes
- `compressionRatio`, `compressedSize / originalSize` (`0.65` means the file is 35% smaller)
- `duration`, in milliseconds
- `buffer`, the native `ArrayBuffer` behind those bytes

```tsx
const result = await compress(pdf, {
  resolution: 'printer',
  imageQuality: 150,
  pdfPassword: 'secret',
  timeout: 60_000,
  signal: controller.signal,
});
```

| Option | Description |
| --- | --- |
| `resolution` | `screen`, `ebook`, `printer`, `prepress`, or `default`. Default is `ebook`. |
| `compatibilityLevel` | PDF compatibility level from `1.0` to `2.0`. Default is `1.4`. |
| `imageQuality` | Image resolution in DPI, from `1` to `600`. Default is `100`. |
| `gsModule` | Path to the Ghostscript binary, such as `/usr/bin/gs`. |
| `pdfPassword` | Password for a protected PDF. |
| `removePasswordAfterCompression` | Drop password protection from the compressed file. |
| `timeout` | How long to wait for Ghostscript, in milliseconds. Default is `120000` (2 minutes). |
| `signal` | `AbortSignal` that cancels the Ghostscript process. |
| `returnOriginalIfLarger` | When `true`, keep the original PDF if Ghostscript output is not smaller. Default is `false`. |

Failures throw `CompressPdfError`. If the binary cannot be found, the message tells you to set `COMPRESS_PDF_BIN_PATH` or install Ghostscript manually. `NaN` is rejected for `imageQuality` and `compatibilityLevel`.

### CLI Usage

```
npx compress-pdf --file input.pdf --output ./compressed.pdf

Required:
  -f, --file <path>
  -o, --output <path>

Options:
  -r, --resolution <preset>     screen | ebook | printer | prepress | default (default: ebook)
  --compatibilityLevel <n>      PDF compatibility level (default: 1.4)
  --imageQuality <n>            Image resolution in DPI, 1-600 (default: 100)
  --gsModule <path>             Ghostscript binary, for example /usr/bin/gs
  --pdfPassword <pass>          Password for a protected PDF. Prefer COMPRESS_PDF_PASSWORD
  --removePasswordAfterCompression
  --returnOriginalIfLarger      Keep the original PDF when compression is not smaller
  -h, --help
```

An unknown flag exits with code 1 and prints the error plus the help text. A resolution outside the list above is rejected before compression starts.

### Usage with Docker

**Option 1: Using Automatic Binary Download (Recommended)**

```dockerfile
FROM node:20 AS build
WORKDIR /src
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build

FROM node:20
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
FROM node:20 AS build
WORKDIR /src
COPY package*.json ./
RUN COMPRESS_PDF_SKIP_DOWNLOAD=true npm i
COPY . .
RUN npm run build

FROM node:20
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

This project is under the MIT license. See [LICENSE](https://github.com/victorsoares96/compress-pdf/blob/master/LICENSE).
