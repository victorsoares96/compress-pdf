/* eslint-disable no-console */
import compress from '@/compress';
import fs from 'fs';
import type { Resolution } from './types';

type CliOptions = {
  '--file': string;
  '--output': string;
  '--resolution'?: Resolution;
  '--compatibilityLevel'?: string;
  '--gsModule'?: string;
  '--pdfPassword'?: string;
  '--removePasswordAfterCompression'?: boolean;
};

(async () => {
  const argv = process.argv.slice(2);
  const args: CliOptions = Object.assign(
    {},
    ...process.argv
      .slice(2)
      .map((e, index) => {
        if (argv[index + 1]) {
          return { [e]: argv[index + 1] };
        }

        return undefined;
      })
      .filter((arg) => arg)
  );

  if (
    process.argv.slice(2).some((arg) => arg.includes('help')) ||
    process.argv.slice(2).some((arg) => arg.includes('-h')) ||
    process.argv.slice(2).length === 0
  ) {
    return console.log(
      'USE: npx compress-pdf\n--file [PDF_FILE]\n--output [COMPRESSED_PDF_FILE]\n--resolution [ebook/printer/screen/prepress]\n--compatibilityLevel [NUMBER] The compatibility pdf level\n--gsModule [FILE PATH] The ghostscript binary path\n--pdfPassword The pdf password\n--removePasswordAfterCompression [BOOLEAN] Remove pdf password after compression \nEx: /usr/local/bin/gs'
    );
  }

  if (!args['--file'] || !args['--output']) {
    return console.log(
      'USE: npx compress-pdf --file [PDF_FILE] --output [COMPRESSED_PDF_FILE]'
    );
  }

  const buffer = await compress(args['--file'], {
    resolution: args['--resolution'] ? args['--resolution'] : undefined,
    compatibilityLevel: args['--compatibilityLevel']
      ? Number(args['--compatibilityLevel'])
      : undefined,
    gsModule: args['--gsModule'],
    pdfPassword: args['--pdfPassword'],
    removePasswordAfterCompression: args['--removePasswordAfterCompression'],
  });

  return fs.writeFileSync(args['--output'], buffer);
})();
