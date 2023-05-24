import fs from 'fs';
import path from 'path';
import os from 'os';
import unzipper from 'unzipper';
import request from 'request';
import { version } from '../package.json';

async function unzipFile(
  file: string,
  destination: string,
  excludeFile = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(unzipper.Extract({ path: destination }))
      .on('error', (error) => reject(error))
      .on('close', () => {
        if (excludeFile) {
          fs.unlinkSync(file);
        }
        resolve(destination);
      });
  });
}

async function downloadFile(
  destination: string,
  url: string,
  filename: string
): Promise<string> {
  let progress = 0;
  let size = 0;

  const output = path.resolve(destination, filename);

  if (fs.existsSync(output)) {
    return output;
  }

  const tmpPath = path.resolve(os.tmpdir(), filename);

  const file = fs.createWriteStream(tmpPath);

  return new Promise((resolve, reject) => {
    request(url, undefined)
      .on('response', (response) => {
        size = Number(response.headers['content-length']);
      })
      .on('data', (data) => {
        file.write(data);

        progress += Buffer.byteLength(data);

        /* process.stdout.write(
          `\rDownloading ${filename} in ${output}, ${Math.floor(
            (progress / size) * 100
          )}%`
        ); */
      })
      .on('close', async () => {
        fs.renameSync(tmpPath, output);
        resolve(output);
      })
      .on('error', (error) => reject(error));
  });
}

export const RELEASE_URL =
  'https://github.com/victorsoares96/compress-pdf/releases/download';
export const GS_VERSION = '10.01.1';

async function fetchBinaries(
  platform: NodeJS.Platform,
  outputPath?: string,
  gsVersion = GS_VERSION
) {
  if (os.arch() !== 'x64') {
    throw new Error('unsupported architecture, this module only support x64');
  }

  if (platform === 'linux') {
    const destination = outputPath || path.resolve(__dirname, '../bin/gs');
    const filename = `linux_${gsVersion}.zip`;
    const url = `${RELEASE_URL}/v${version}/gs_${gsVersion}_linux.zip`;

    const file = await downloadFile(destination, url, filename);

    await unzipFile(file, destination, true);
    return;
  }

  if (platform === 'win32') {
    const destination = outputPath || path.resolve(__dirname, `../bin/gs`);
    const filename = `windows_${gsVersion}.zip`;
    const url = `${RELEASE_URL}/v${version}/gs_${gsVersion}_windows.zip`;

    const file = await downloadFile(destination, url, filename);

    await unzipFile(file, destination, true);
    return;
  }

  throw new Error(
    'unsupported platform, this module only support windows and linux'
  );
}

export default fetchBinaries;
