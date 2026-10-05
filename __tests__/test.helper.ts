import { PDFParse } from 'pdf-parse';

export type ParsedPdf = {
  numpages: number;
  numrender: number;
  text: string;
};

export async function parsePDF(src: {
  data: Buffer | Uint8Array;
  password?: string;
}): Promise<ParsedPdf> {
  const parser = new PDFParse({
    data: src.data,
    password: src.password,
  });

  try {
    const result = await parser.getText();
    return {
      numpages: result.total,
      numrender: result.pages.length,
      text: result.text,
    };
  } finally {
    await parser.destroy();
  }
}
