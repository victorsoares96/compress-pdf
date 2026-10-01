# compress-pdf

Compress PDF files with Ghostscript. Requires Node.js 20 or newer.

## Installation

```sh
npm install compress-pdf
```

The Ghostscript binary is downloaded during install.

## Usage

```ts
import { compress } from 'compress-pdf';

const result = await compress('input.pdf', {
  output: 'compressed.pdf',
});
```

`result` includes:

- `originalSize` and `compressedSize`, in bytes
- `compressionRatio`, `compressedSize / originalSize` (`0.65` means the file is 35% smaller)
- `duration`, in milliseconds
- `output`, the absolute path written

## Options

| Option                           | Description                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `resolution`                     | `screen`, `ebook`, `printer`, `prepress`, `default`, or `auto`. Default: `ebook`.                                                 |
| `compatibilityLevel`             | PDF version from `1.0` to `2.0`. Default: `1.4`. With `pdfa`, an omitted level becomes `1.4` for `1b` and `1.7` for `2b` or `3b`. |
| `pdfa`                           | `1b`, `2b`, or `3b`. Writes PDF/A in the same pass and converts color to RGB.                                                     |
| `imageQuality`                   | Image DPI from `1` to `600`. Default: `100`.                                                                                      |
| `gsModule`                       | Path to the Ghostscript binary.                                                                                                   |
| `pdfPassword`                    | Password for a protected PDF.                                                                                                     |
| `removePasswordAfterCompression` | Drop password protection from the output.                                                                                         |
| `timeout`                        | How long to wait for Ghostscript, in milliseconds. Default: `120000`.                                                             |
| `signal`                         | `AbortSignal` that cancels Ghostscript.                                                                                           |
| `returnOriginalIfLarger`         | Keep the original PDF when the output is not smaller. Default: `false`.                                                           |
| `output`                         | Path to write. The return value is metadata plus that absolute path.                                                              |
| `targetSize`                     | Max size in bytes. Tries up to 6 milder settings and returns the smallest if none fit.                                            |
| `stripMetadata`                  | Clear title, author, subject, keywords, and creator. Default: `false`.                                                            |
| `setMetadata`                    | Set `title`, `author`, `subject`, and `keywords`.                                                                                 |
| `sanitize`                       | Clear document info, including the extra metadata block. Links, forms, and annotations stay. Default: `false`.                    |
| `pages`                          | Pages to keep, from 1, such as `1-3,5`.                                                                                           |

## Recipes

### Choose a preset

`analyze` reads the PDF. Pass `resolution: 'auto'` to compress with the preset that matches it.

```ts
import { analyze, compress } from 'compress-pdf';

const info = await analyze('scan.pdf');
await compress('scan.pdf', {
  resolution: 'auto',
  output: 'compressed.pdf',
});
```

- `scanned`: images and almost no fonts (no fonts, or fewer than one font for every ten images). `auto` uses `screen`.
- `vector`: fonts and no images. `auto` uses `printer`.
- `mixed`: everything else. `auto` uses `ebook`.
- `estimatedGain` is `0.6`, `0.3`, or `0.1`: a guess, not a measurement.
- `auto` is never sent to Ghostscript. With `targetSize`, the search starts at that preset. Omitting `resolution` still uses `ebook`.

### Merge files

Several PDFs are joined in order into one `output`.

```ts
await compress(['a.pdf', 'b.pdf'], { output: 'merged.pdf' });
```

`pages`, `resolution: 'auto'`, and `returnOriginalIfLarger` need a single PDF. One password is used for every file.

### Keep pages

`pages` keeps part of one PDF in the same compression pass.

```ts
await compress('input.pdf', {
  pages: '1-3,5',
  output: 'compressed.pdf',
});
```

`5-1` stays backwards. A page past the end is rejected.

### Split

`split` writes one compressed file per page. `concurrency` is from 1 to 8. The default is the CPU count, capped at 4.

```ts
import { split } from 'compress-pdf';

const parts = await split('input.pdf', {
  output: 'pages/page-%d.pdf',
  pages: '2,1',
});
```

`%d` becomes the source page number. A repeated page is rejected. If one page fails, the others stop and every file from this split is removed. A delete that is still busy is tried once more.

### Fit a size

`targetSize` tries milder settings until the file fits.

```ts
await compress('input.pdf', {
  targetSize: 500_000,
  output: 'compressed.pdf',
});
```

It tries up to 6 times. If none fit, it returns the smallest. With `resolution: 'auto'`, the search starts from the preset `analyze` chose.

### Metadata

Clear or replace document info.

```ts
await compress('input.pdf', {
  sanitize: true,
  setMetadata: { title: 'Report', author: 'Ada' },
  output: 'compressed.pdf',
});
```

Ghostscript still writes its own producer and dates. With `stripMetadata` or `sanitize`, a field omitted from `setMetadata` is cleared. `sanitize` also clears the extra metadata block. Links, forms, and annotations stay.

### Return a Buffer

Without `output`, the return value is the compressed PDF as a `Buffer`.

```ts
import { writeFile } from 'node:fs/promises';
import { compress } from 'compress-pdf';

const buffer = await compress('input.pdf');
await writeFile('compressed.pdf', buffer);
```

`buffer` is the native `ArrayBuffer` behind those bytes. The size fields are the same as an `output` result.

### Streams

`compress` accepts a `Uint8Array`, an `ArrayBuffer`, a Node.js stream, or a web stream. `compressStream` returns a Node.js stream of the finished PDF.

```ts
import { createReadStream } from 'node:fs';
import { compressStream } from 'compress-pdf';

const stream = await compressStream(createReadStream('input.pdf'));
```

The input is read to the end and stored in a temporary file before Ghostscript runs. `compressStream` starts only after Ghostscript finishes, rejects `output`, and deletes that file when the stream closes. With `returnOriginalIfLarger`, the stream can carry the original bytes. `split` reads a stream once and reuses that file for every page.

## Errors

- Failures throw `CompressPdfError`.
- If the binary cannot be found, the message tells you to set `COMPRESS_PDF_BIN_PATH` or install Ghostscript manually.
- `NaN` is rejected for `imageQuality` and `compatibilityLevel`.
- An empty byte view or an empty stream is rejected.

## CLI

```
npx compress-pdf --file input.pdf --output ./compressed.pdf

Required:
  -f, --file <path>             Repeat to join files in order. Use - for stdin
  -o, --output <path>           Use %d to write one file per page, or - for stdout

Options:
  --batch <directory>           Compress each PDF in that folder, without joining
  -r, --resolution <preset>     screen | ebook | printer | prepress | default | auto (default: ebook)
  --pages <list>                Pages to keep, such as 1-3,5
  --concurrency <n>             Pages at once when -o contains %d (1-8, default: CPU count, max 4)
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

- An unknown flag exits with code 1 and prints the error plus the help text.
- Repeating `-f` joins files in order. `-f -` reads stdin once.
- An `-o` path that contains `%d` writes one file per page. `--concurrency` is accepted only in that case (1–8; default: CPU count, capped at 4).
- `-o -` writes the PDF to stdout and the summary to stderr. A library `output` of `'-'` is still a file named `-`.
- `--batch <directory>` compresses each PDF in that folder, not in subfolders, and does not join them. `-o` must be a different directory. One bad file does not stop the others. The command exits 1 if any file failed. `--batch` cannot be combined with `-f`, with `-o -`, or with `%d` in `-o`.

## HTTP adapters

Express, Fastify, and Next.js each have a handler. Install only the framework the app already uses. Importing `compress-pdf` does not load them.

- The request body is the PDF (`Content-Type: application/pdf`). The response is the compressed PDF, with `X-Original-Size`, `X-Compressed-Size`, and `X-Compression-Ratio`.
- `output` is rejected. Cancelling the request aborts Ghostscript. A Ghostscript error returns 500 with the message, without a stack or a filesystem path.
- Express uses the limit on `express.raw`. Fastify uses the route `bodyLimit`, or the limit passed to `Fastify()` when the route omits it. Next.js reads at most `bodyLimit` bytes and returns 413 past that. The Next.js default is 20 MiB.
- Fastify registers an `application/pdf` parser when the app does not already have one. Another route in that app still receives 415 for `application/pdf`.
- The Next.js handler is for the App Router. `output` is rejected before the body is read.

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

```ts
import { compressPdf } from 'compress-pdf/next';

export const POST = compressPdf({ resolution: 'ebook' });
```

## Ghostscript

`npm install` downloads a Ghostscript binary for your operating system and extracts it to `bin/gs`.

### Environment variables

| Variable                     | Effect                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `COMPRESS_PDF_SKIP_DOWNLOAD` | Set to `true` to skip the binary download during install.                                                                                                    |
| `COMPRESS_PDF_BIN_PATH`      | Path to a Ghostscript binary to use instead.                                                                                                                 |
| `COMPRESS_PDF_PASSWORD`      | PDF password when `pdfPassword` or `--pdfPassword` is omitted. The flag is stored in shell history, so prefer this variable. If both are set, the flag wins. |

### Manual installation

Install Ghostscript yourself and point `COMPRESS_PDF_BIN_PATH` at the `gs` binary.

**Ubuntu**

```sh
sudo apt-get install ghostscript -y
```

**macOS**

```sh
brew install ghostscript
```

**Windows (Chocolatey)**

```sh
choco install ghostscript
```

or [download](https://ghostscript.com/releases/gsdnld.html) the Ghostscript `.exe` installer.

### Docker

The package install downloads the binary. A Node image does not need a Ghostscript package:

```dockerfile
RUN npm install compress-pdf
```

To use the system binary instead:

```dockerfile
RUN apt-get update && apt-get install -y ghostscript
ENV COMPRESS_PDF_SKIP_DOWNLOAD=true
RUN npm install compress-pdf
```

Scripts are in the [examples folder](https://github.com/victorsoares96/compress-pdf/tree/master/examples).

## License

This project is under the MIT license. See [LICENSE](https://github.com/victorsoares96/compress-pdf/blob/master/LICENSE).
