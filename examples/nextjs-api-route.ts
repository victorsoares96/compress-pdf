/**
 * Next.js App Router — API route that compresses an uploaded PDF.
 *
 * Place this file at: app/api/compress/route.ts
 */
import { NextRequest, NextResponse } from 'next/server';
import { compress, CompressPdfError } from 'compress-pdf';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json(
      {
        error:
          'No file provided. Send a multipart/form-data with field "file".',
      },
      { status: 400 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const resolution =
    (request.nextUrl.searchParams.get('resolution') as any) ?? 'ebook';
  const jpegQuality = request.nextUrl.searchParams.get('jpegQuality');
  const imageDpi = request.nextUrl.searchParams.get('imageDpi');

  try {
    const result = await compress(inputBuffer, {
      resolution,
      jpegQuality: jpegQuality ? Number(jpegQuality) : undefined,
      imageDpi: imageDpi ? Number(imageDpi) : undefined,
    });

    return new NextResponse(result, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="compressed.pdf"',
        'X-Original-Size': String(result.originalSize),
        'X-Compressed-Size': String(result.compressedSize),
        'X-Compression-Ratio': String(result.compressionRatio),
      },
    });
  } catch (err) {
    if (err instanceof CompressPdfError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
