import type { ImageData } from '../pdf/image-optimizer';

type JpegDecoder = (buffer: ArrayBuffer) => Promise<ImageData>;
type JpegEncoder = (
  data: ImageData,
  options?: { quality: number }
) => Promise<ArrayBuffer>;
type Resizer = (
  data: ImageData,
  options: { width: number; height: number }
) => Promise<ImageData>;

let decodeJpeg: JpegDecoder | null = null;
let encodeJpeg: JpegEncoder | null = null;
let resizeImage: Resizer | null = null;

export async function getJpegDecoder(): Promise<JpegDecoder> {
  if (!decodeJpeg) {
    const mod = await import('@jsquash/jpeg/decode');
    decodeJpeg = mod.default as JpegDecoder;
  }
  return decodeJpeg;
}

export async function getJpegEncoder(): Promise<JpegEncoder> {
  if (!encodeJpeg) {
    const mod = await import('@jsquash/jpeg/encode');
    encodeJpeg = mod.default as JpegEncoder;
  }
  return encodeJpeg;
}

export async function getResizer(): Promise<Resizer> {
  if (!resizeImage) {
    const mod = await import('@jsquash/resize');
    resizeImage = mod.default as unknown as Resizer;
  }
  return resizeImage;
}
