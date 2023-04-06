import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import unzipper from 'unzipper';
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
  if (fs.existsSync(destination)) {
    throw new Error('File already exists');
  }

  const tmpPath = path.resolve(os.tmpdir(), filename);

  fs.writeFileSync(tmpPath, '');
  const file = fs.createWriteStream(tmpPath);

  function deleteFile() {
    fs.unlinkSync(tmpPath);
    process.exit();
  }

  const memoryUsage = [0];
  let progress = 0;

  process.on('SIGINT', deleteFile);

  return new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
      const size = Number(res.headers['content-length']);

      res.on('data', (data) => {
        file.write(data);

        progress += Buffer.byteLength(data);

        process.stdout.write(
          `\rDownloading ${filename} ${Math.floor((progress / size) * 100)}%`
        );

        memoryUsage.push(process.memoryUsage().heapUsed);
      });

      res.on('error', function (error) {
        reject(error);
        fs.unlinkSync(tmpPath);
      });

      res.on('end', async function () {
        file.close();

        await fs.promises.rename(tmpPath, destination);

        resolve(destination);
      });
    });

    req.end();
  });
}

export const RELEASE_URL =
  'https://github.com/victorsoares96/compress-pdf/releases/download';
export const GS_VERSION = '10.01.1';

async function fetchBinaries(
  platform: NodeJS.Platform,
  gsVersion = GS_VERSION
) {
  if (os.arch() !== 'x64') {
    throw new Error('unsupported architecture, this module only support x64');
  }

  if (platform === 'linux') {
    const destination = path.resolve(__dirname, '../bin/gs');
    const filename = `linux_${gsVersion}`;

    const file = await downloadFile(
      destination,
      `${RELEASE_URL}/v${version}/gs_${gsVersion}_linux.zip`,
      filename
    );

    await unzipFile(file, destination, true);
  }

  if (platform === 'win32') {
    const destination = path.resolve(__dirname, '../bin/gs');
    const filename = `windows_${gsVersion}`;

    const file = await downloadFile(
      destination,
      `${RELEASE_URL}/v${version}/gs_${gsVersion}_windows.zip`,
      filename
    );

    await unzipFile(file, destination, true);
  }

  throw new Error(
    'unsupported platform, this module only support windows and linux'
  );
}

export default fetchBinaries;
