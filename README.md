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

`compress()` returns a `Buffer` with metadata. Pass `output` to write the file instead and get metadata plus the absolute path, without loading the compressed PDF into memory:

- `originalSize` and `compressedSize`, in bytes
- `compressionRatio`, `compressedSize / originalSize` (`0.65` means the file is 35% smaller)
- `duration`, in milliseconds
- `buffer`, the native `ArrayBuffer` behind those bytes (Buffer return only)
- `output`, the absolute path written (when `output` is set)

```tsx
const result = await compress(pdf, {
  resolution: 'printer',
  imageQuality: 150,
  pdfPassword: 'secret',
  timeout: 60_000,
  signal: controller.signal,
  output: './compressed.pdf',
});
```

| Option                           | Description                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolution`                     | `screen`, `ebook`, `printer`, `prepress`, `default`, or `auto`. Default is `ebook`. `auto` picks a preset from `analyze`.                                                         |
| `compatibilityLevel`             | PDF compatibility level from `1.0` to `2.0`. Default is `1.4`. With `pdfa`, an omitted level becomes `1.4` for `1b` and `1.7` for `2b` or `3b`.                                   |
| `pdfa`                           | `1b`, `2b`, or `3b`. Omitted by default. Writes a PDF/A file in the same pass, converting color to RGB. Features that cannot be kept are dropped. The PDF/A identification stays. |
| `imageQuality`                   | Image resolution in DPI, from `1` to `600`. Default is `100`.                                                                                                                     |
| `gsModule`                       | Path to the Ghostscript binary, such as `/usr/bin/gs`.                                                                                                                            |
| `pdfPassword`                    | Password for a protected PDF.                                                                                                                                                     |
| `removePasswordAfterCompression` | Drop password protection from the compressed file.                                                                                                                                |
| `timeout`                        | How long to wait for Ghostscript, in milliseconds. Default is `120000` (2 minutes).                                                                                               |
| `signal`                         | `AbortSignal` that cancels the Ghostscript process.                                                                                                                               |
| `returnOriginalIfLarger`         | When `true`, keep the original PDF if Ghostscript output is not smaller. Default is `false`.                                                                                      |
| `output`                         | Path to write the compressed PDF. When set, Ghostscript writes there and the return value is metadata plus that absolute path.                                                    |
| `targetSize`                     | Max size in bytes. Tries up to 6 milder preset/DPI settings and returns the first result that fits, or the smallest attempt if none fit.                                          |
| `stripMetadata`                  | When `true`, clear title, author, subject, keywords, and creator. Default is `false`. Ghostscript still writes its own producer and dates.                                        |
| `setMetadata`                    | Set `title`, `author`, `subject`, and `keywords`. With `stripMetadata` or `sanitize`, fields you omit are cleared.                                                                |
| `sanitize`                       | When `true`, clear the same document info. Ghostscript then rebuilds the extra metadata block from those cleared values. Links, forms, and annotations stay. Default is `false`.  |
| `pages`                          | Pages to keep, numbered from 1, such as `1-3,5`. Omitted by default, so the whole PDF is compressed. `5-1` stays backwards. A page past the end is rejected.                      |

`analyze(file)` reads the PDF and returns pages, images, the highest image DPI, fonts, and a kind:

- `scanned` when the PDF has images and almost no fonts (no fonts, or fewer than one font for every ten images)
- `vector` when it has fonts and no images
- `mixed` otherwise

`estimatedGain` (`0.6`, `0.3`, or `0.1`) is a rough guess of how much compression might save, not a measurement.

`resolution: 'auto'` uses that kind: scanned files use `screen`, mixed files use `ebook`, and vector files use `printer`. Leaving `resolution` out still uses `ebook`. `auto` is never sent to Ghostscript. With `targetSize`, the chosen preset is where the search starts.

```tsx
import { analyze, compress } from 'compress-pdf';

const info = await analyze('./scan.pdf');
const compressed = await compress('./scan.pdf', { resolution: 'auto' });
```

`pages` keeps part of one PDF in the same compression pass. `compress` also accepts a list of PDFs and joins them in that order. `pages`, `resolution: 'auto'`, and `returnOriginalIfLarger` need a single PDF. One password is used for every file.

`compress` also accepts a `Uint8Array`, an `ArrayBuffer`, a Node.js stream, or a web stream. Those are read to the end and stored in a temporary file before Ghostscript runs. An empty byte view or an empty stream is rejected. `split` and `analyze` accept the same inputs. `split` reads a stream once and reuses that file for every page.

`compressStream` returns a Node.js stream of the finished PDF, with the same size fields as a `Buffer` result. It starts only after Ghostscript finishes. `output` is rejected. Closing the stream removes the temporary file. With `returnOriginalIfLarger`, the stream can carry the original bytes.

`split` writes one compressed file per page. The output path must contain `%d`, which is replaced with the source page number. A repeated page is rejected. If a later page fails, files from this split are removed:

```tsx
import { split } from 'compress-pdf';

await compress(['a.pdf', 'b.pdf'], { output: 'merged.pdf' });
await compress('./input.pdf', { pages: '1-3,5' });

const parts = await split('./input.pdf', {
  output: './pages/page-%d.pdf',
  pages: '2,1',
});
```

Failures throw `CompressPdfError`. If the binary cannot be found, the message tells you to set `COMPRESS_PDF_BIN_PATH` or install Ghostscript manually. `NaN` is rejected for `imageQuality` and `compatibilityLevel`.

### CLI Usage

```
npx compress-pdf --file input.pdf --output ./compressed.pdf

Required:
  -f, --file <path>             Repeat to join files in order. Use - for stdin
  -o, --output <path>           Use %d to write one file per page, or - for stdout

Options:
  --batch <directory>           Compress each PDF in that folder, without joining
  -r, --resolution <preset>     screen | ebook | printer | prepress | default | auto (default: ebook)
  --pages <list>                Pages to keep, such as 1-3,5
  --compatibilityLevel <n>      PDF compatibility level (default: 1.4)
  --pdfa <level>                Write PDF/A in the same pass: 1b, 2b, or 3b
  --imageQuality <n>            Image resolution in DPI, 1-600 (default: 100)
  --gsModule <path>             Ghostscript binary, for example /usr/bin/gs
  --pdfPassword <pass>          Password for a protected PDF. Prefer COMPRESS_PDF_PASSWORD
  --removePasswordAfterCompression
  --returnOriginalIfLarger      Keep the original PDF when compression is not smaller
  --targetSize <bytes>          Try milder settings until the file fits
  --stripMetadata               Clear title, author, subject, keywords, and creator
  --sanitize                    Clear document info, including the extra metadata block
  --title <text>                Set the compressed PDF title
  --author <text>               Set the compressed PDF author
  --subject <text>              Set the compressed PDF subject
  --keywords <text>             Set the compressed PDF keywords
  -h, --help
```

An unknown flag exits with code 1 and prints the error plus the help text. A resolution outside the list above is rejected before compression starts. `-r auto` is accepted. `--pages` uses the same page list as `pages`. Repeating `-f` joins files. An `-o` path that contains `%d` splits into one file per page. `-f -` reads stdin once. `-o -` writes the PDF to stdout and the summary to stderr. A library `output` of `'-'` is still a file named `-`.

`--batch <directory>` compresses each PDF in that folder, not in subfolders, and does not join them. `-o` must be a different directory. Each result keeps the original file name. One bad file does not stop the others. The command exits 1 if any file failed. `--batch` cannot be combined with `-f`, with `-o -`, or with `%d` in `-o`.

### HTTP adapters

Express, Fastify, and Next.js each have a handler that calls `compress` and returns the smaller PDF. Install only the framework the app already uses. Importing `compress-pdf` does not load them. The request body is the PDF (`Content-Type: application/pdf`). The response is the compressed PDF, with `X-Original-Size`, `X-Compressed-Size`, and `X-Compression-Ratio`. `output` is rejected. Cancelling the request aborts Ghostscript. A Ghostscript error returns 500 with the message, without a stack or a filesystem path.

Express uses the limit on `express.raw`. Fastify uses the route `bodyLimit`, or the limit passed to `Fastify()` when the route omits it. `compressPdf({ bodyLimit })` sets that route limit. Next.js reads at most `bodyLimit` bytes and returns 413 past that. The Next.js default is 20 MiB.

```ts
import express from 'express';
import { compressPdf } from 'compress-pdf/express';

const app = express();

app.post(
  '/compress',
  express.raw({ type: 'application/pdf', limit: '20mb' }),
  compressPdf({ resolution: 'ebook' })
);
```

```ts
import Fastify from 'fastify';
import { compressPdf } from 'compress-pdf/fastify';

const app = Fastify();

app.post(
  '/compress',
  compressPdf({ resolution: 'ebook', bodyLimit: 20 * 1024 * 1024 })
);
```

Fastify registers an `application/pdf` parser when the app does not already have one. The parser runs for routes created with `compressPdf`. Another route in that app still receives 415 for `application/pdf`.

```ts
import { compressPdf } from 'compress-pdf/next';

export const POST = compressPdf({ resolution: 'ebook' });
```

The Next.js handler is for the App Router. `output` is rejected before the body is read.

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
