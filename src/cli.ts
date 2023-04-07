/* eslint-disable no-console */
import compress from '@/compress';
import fs from 'fs';
import type { Resolution } from './types';
import fetchBinaries from './fetch-binaries';

type CliOptions = {
  '--file': string;
  '--output': string;
  '--resolution'?: Resolution;
  '--compatibilityLevel'?: string;
  '--binPath'?: string;
  '--fetchBinaries'?: NodeJS.Platform;
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
    process.argv.slice(2).length === 0
  ) {
    return console.log(
      'USE: npx compress-pdf\n--file [PDF_FILE]\n--output [COMPRESSED_PDF_FILE]\n--resolution [ebook/printer/screen/prepress]\n--compatibilityLevel [NUMBER] The compatibility pdf level\n--binPath [DIRECTORY] The directory of ghostscript binaries\n--fetchBinaries [win32/linux] Download binaries to default binaries path'
    );
  }

  if (args['--fetchBinaries']) {
    await fetchBinaries(args['--fetchBinaries']);
    return null;
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
    binPath: args['--binPath'],
  });

  return fs.writeFileSync(args['--output'], buffer);
})();
