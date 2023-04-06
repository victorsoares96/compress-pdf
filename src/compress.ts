import path from 'path';
import util from 'util';
import fs from 'fs';
import os from 'os';
import childProcess from 'child_process';
import { defaults } from 'lodash';
import getBinPath from './get-bin-path';
import getGSModulePath from './get-gs-module-path';
import type { Options } from './types';

const exec = util.promisify(childProcess.exec);

const defaultOptions: Required<Options> = {
  compatibilityLevel: 1.4,
  resolution: 'ebook',
  binPath: getBinPath(os.platform()),
};

async function compress(file: string, options?: Options) {
  const { resolution, compatibilityLevel, binPath } = defaults(
    defaultOptions,
    options
  );

  const output = path.resolve(os.tmpdir(), Date.now().toString());
  const gsModule = getGSModulePath(binPath, os.platform());

  await exec(
    `${gsModule} -sDEVICE=pdfwrite -dCompatibilityLevel=${compatibilityLevel} -dPDFSETTINGS=/${resolution} -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${output} ${file}`
  );

  const readFile = await fs.promises.readFile(output);
  const buffer = Buffer.from(readFile);

  return buffer;
}

export default compress;
