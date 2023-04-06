import compress from '@/compress';
import getBinPath from './get-bin-path';
import getGSModulePath from './get-gs-module-path';
import fetchBinaries, { GS_VERSION, RELEASE_URL } from './fetch-binaries';

export * from './types';

export {
  compress,
  getBinPath,
  getGSModulePath,
  fetchBinaries,
  GS_VERSION,
  RELEASE_URL,
};

export default compress;
