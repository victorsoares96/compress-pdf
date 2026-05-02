# compress-pdf

[![npm version](https://img.shields.io/npm/v/compress-pdf)](https://www.npmjs.com/package/compress-pdf)
[![license](https://img.shields.io/npm/l/compress-pdf)](LICENSE)
[![node](https://img.shields.io/node/v/compress-pdf)](package.json)

> Compress PDF files in Node.js — no Ghostscript, no binaries, no `postinstall` downloads.

**compress-pdf** reduces PDF file sizes by recompressing image streams (JPEG via [mozjpeg](https://github.com/mozilla/mozjpeg) WebAssembly) and optimizing internal data streams (via Node.js built-in `zlib`). The entire engine ships inside the npm package — nothing to install separately.

---

## What's new in v1.0.0

| | v0.x | v1.0.0 |
|---|---|---|
| **Engine** | Ghostscript binary (spawned subprocess) | pdf-lib + mozjpeg WebAssembly |
| **Install size** | ~50 MB (GS binary downloaded at `postinstall`) | ~10 MB (WASM bundled) |
| **Works on Alpine / Docker slim** | ❌ Often breaks | ✅ Always |
| **Works on ARM (M1/M2, Pi)** | ❌ Depends on binary | ✅ Always |
| **Works in serverless (Lambda, Vercel, Fly)** | ❌ Binary size + permissions | ✅ Always |
| **`postinstall` download** | ✅ Required | ❌ Removed |
| **License stack** | AGPL (GS binary) | MIT + BSD |

---

## Installation

```sh
npm install compress-pdf
```

```sh
yarn add compress-pdf
```

No environment variables, no binary downloads, no system dependencies required.

---

## Quick start

```ts
import { compress } from 'compress-pdf';

const result = await compress('path/to/file.pdf');

// result is a Buffer — write it directly
await fs.promises.writeFile('compressed.pdf', result);

// Access compression metadata
console.log(`${result.originalSize} → ${result.compressedSize} bytes`);
console.log(`${((1 - result.compressionRatio) * 100).toFixed(1)}% smaller`);
console.log(`Took ${result.duration}ms`);
```

---

## Backend examples

### Node.js / plain script

See [`examples/basic.ts`](examples/basic.ts) for a self-contained example.

### Express.js — PDF upload endpoint

```ts
import express from 'express';
import multer from 'multer';
import { compress, CompressPdfError } from 'compress-pdf';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/compress', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const result = await compress(req.file.buffer, { resolution: 'ebook' });

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="compressed.pdf"');
    res.send(result);
  } catch (err) {
    if (err instanceof CompressPdfError) {
      res.status(422).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Unexpected error' });
    }
  }
});
```

Full example: [`examples/express-server.ts`](examples/express-server.ts)

### Next.js — App Router API route

```ts
// app/api/compress/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { compress, CompressPdfError } from 'compress-pdf';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await compress(buffer, { resolution: 'ebook' });

    return new NextResponse(result, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  } catch (err) {
    if (err instanceof CompressPdfError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

Full example: [`examples/nextjs-api-route.ts`](examples/nextjs-api-route.ts)

---

## Protected PDFs

```ts
import { compress, CompressPdfError } from 'compress-pdf';

// Compress a password-protected PDF (keeps the password)
const result = await compress('protected.pdf', {
  pdfPassword: 'mysecret',
});

// Compress and remove the password
const unlocked = await compress('protected.pdf', {
  pdfPassword: 'mysecret',
  removePasswordAfterCompression: true,
});

// Handle wrong password
try {
  await compress('protected.pdf', { pdfPassword: 'wrong' });
} catch (err) {
  if (err instanceof CompressPdfError) {
    console.error(err.message); // "Wrong password for encrypted PDF"
  }
}
```

Full example: [`examples/protected.ts`](examples/protected.ts)

> **Encryption support:** RC4-40, RC4-128, AES-128. AES-256 (PDF 2.0) is not supported and throws `CompressPdfError`.

---

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `resolution` | `'screen' \| 'ebook' \| 'printer' \| 'prepress' \| 'default'` | `'ebook'` | Quality preset. Sets DPI and JPEG quality together. |
| `imageDpi` | `number` | preset value | Target DPI for image downsampling (1–600). Overrides the preset's DPI. |
| `jpegQuality` | `number` | preset value | mozjpeg encoder quality (0–100). Overrides the preset's quality. |
| `pdfPassword` | `string` | — | Password to open an encrypted PDF. |
| `removePasswordAfterCompression` | `boolean` | `false` | Save the output without a password. Requires `pdfPassword`. |

`imageDpi` and `jpegQuality` can be combined with `resolution` to partially override a preset:

```ts
// Use ebook preset but push JPEG quality lower
await compress('file.pdf', { resolution: 'ebook', jpegQuality: 40 });

// Use printer DPI but cap JPEG quality
await compress('file.pdf', { resolution: 'printer', jpegQuality: 70 });
```

---

## Compression presets

| Preset | DPI | JPEG quality | Best for |
|---|---|---|---|
| `screen` | 72 | 35 | Web display, email — smallest file |
| `ebook` | 150 | 65 | General purpose **(default)** |
| `printer` | 300 | 85 | Office printing |
| `prepress` | 300 | 95 | Professional print — minimal compression |
| `default` | 150 | 75 | Balanced, slightly better quality than `ebook` |

Compare all presets side by side: [`examples/presets.ts`](examples/presets.ts)

### Typical compression rates

Results depend heavily on file content:

| Content type | Expected reduction |
|---|---|
| Image-heavy PDF | 40–70% |
| Mixed PDF (text + images) | 35–60% |
| Text-only / forms | 8–25% |

> **Font subsetting is not supported.** PDFs with large embedded fonts (CJK scripts, decorative typefaces) will see lower gains compared to Ghostscript-based tools.

---

## Error handling

All errors are thrown as `CompressPdfError`:

```ts
import { compress, CompressPdfError } from 'compress-pdf';

try {
  const result = await compress('file.pdf');
} catch (err) {
  if (err instanceof CompressPdfError) {
    console.error(err.message); // human-readable message
    console.error(err.cause);   // original underlying error, if any
  }
}
```

| Condition | Error message |
|---|---|
| File not found | `"File not found: <path>"` |
| Invalid PDF | `"Failed to parse PDF: <reason>"` |
| Encrypted, no password | `"PDF is encrypted, provide pdfPassword"` |
| Wrong password | `"Wrong password for encrypted PDF"` |
| AES-256 (unsupported) | `"PDF uses AES-256 encryption, not supported"` |
| `imageDpi` out of range | `"Invalid imageDpi: must be between 1 and 600"` |
| `jpegQuality` out of range | `"Invalid jpegQuality: must be between 0 and 100"` |

---

## CLI

```sh
npx compress-pdf --file input.pdf --output compressed.pdf

# Options
  -f, --file <path>          Input PDF path (required)
  -o, --output <path>        Output PDF path (required)
  -r, --resolution <preset>  screen | ebook | printer | prepress | default
      --imageDpi <n>         Target image DPI, 1–600
      --jpegQuality <n>      JPEG quality, 0–100
      --pdfPassword <pass>   Password for encrypted PDFs
      --removePasswordAfterCompression
  -h, --help
```

```sh
# Examples
npx compress-pdf -f report.pdf -o report-compressed.pdf
npx compress-pdf -f report.pdf -o report-compressed.pdf -r screen
npx compress-pdf -f report.pdf -o report-compressed.pdf --imageDpi 72 --jpegQuality 40
npx compress-pdf -f secured.pdf -o output.pdf --pdfPassword secret
npx compress-pdf -f secured.pdf -o output.pdf --pdfPassword secret --removePasswordAfterCompression
```

---

## Docker

No special configuration needed. Works with any standard Node.js image:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "dist/index.js"]
```

### With a custom non-root user

```dockerfile
FROM node:20-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --chown=appuser:appgroup package*.json ./
RUN npm install
COPY --chown=appuser:appgroup . .
USER appuser
CMD ["node", "dist/index.js"]
```

### Multi-stage production build

```dockerfile
FROM node:20-alpine AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /src/dist ./dist
CMD ["node", "dist/index.js"]
```

### Serverless (AWS Lambda with container image)

```dockerfile
FROM public.ecr.aws/lambda/nodejs:20
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
CMD ["dist/handler.handler"]
```

> No `COMPRESS_PDF_SKIP_DOWNLOAD` or extra apt packages needed — the library is fully self-contained.

---

## TypeScript

The library is written in TypeScript and ships with full type definitions:

```ts
import { compress, CompressPdfError } from 'compress-pdf';
import type { Options, CompressResult, Resolution } from 'compress-pdf';

async function compressPdf(
  input: string | Buffer,
  options?: Options
): Promise<Buffer & CompressResult> {
  return compress(input, options);
}
```

---

## Migrating from v0.x

```ts
// v0.x
await compress('file.pdf', {
  imageQuality: 150,        // ← was DPI despite the name
  compatibilityLevel: 1.4,  // ← GS-specific
  gsModule: '/usr/bin/gs',  // ← binary path
});

// v1.0.0
await compress('file.pdf', {
  imageDpi: 150,            // ← renamed for clarity
  // compatibilityLevel removed — pdf-lib outputs PDF 1.7
  // gsModule removed — no binary
});
```

| v0.x option | v1.0.0 | Notes |
|---|---|---|
| `imageQuality` | `imageDpi` | Renamed — was always DPI |
| `jpegQuality` | `jpegQuality` | New — JPEG encoder quality 0–100 |
| `compatibilityLevel` | removed | pdf-lib always outputs PDF 1.7 |
| `gsModule` | removed | No binary path needed |

---

## Known limitations

- **Font subsetting:** Not supported. PDFs with large embedded fonts compress less than with Ghostscript.
- **PNG/TIFF images:** Not quality-reduced — only Flate-recompressed. JPEG is the main compression target.
- **AES-256 encryption:** Not supported (PDF 2.0). RC4 and AES-128 work fine.
- **Browser:** Not supported in this version. The library uses Node.js built-ins (`fs`, `zlib`).

---

## Examples

| File | Description |
|---|---|
| [`examples/basic.ts`](examples/basic.ts) | Compress a file and log metadata |
| [`examples/protected.ts`](examples/protected.ts) | Compress with password / remove password |
| [`examples/presets.ts`](examples/presets.ts) | Compare all resolution presets |
| [`examples/express-server.ts`](examples/express-server.ts) | Express.js upload endpoint |
| [`examples/nextjs-api-route.ts`](examples/nextjs-api-route.ts) | Next.js App Router API route |

---

## License

MIT — see [LICENSE](LICENSE) for details.

The WebAssembly modules bundled in this package use the following licenses:
- [pdf-lib](https://github.com/Hopding/pdf-lib) — MIT
- [@jsquash/jpeg](https://github.com/jamsinclair/jSquash) — MIT (mozjpeg: BSD)
- [@jsquash/resize](https://github.com/jamsinclair/jSquash) — MIT
