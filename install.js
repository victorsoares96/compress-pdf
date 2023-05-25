const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const os = require('os');
const fs = require('fs');
const childProcess = require('child_process');
const util = require('util');

const exec = util.promisify(childProcess.exec);

(async () => {
  if (fs.existsSync(path.resolve(__dirname, '../dist')) && !process.env.SKIP_GS_BINARY_DOWNLOAD) {
    const fetchBinaries = require('./fetch-binaries');
    const gsPath = path.resolve(__dirname, '../bin/gs');

    await fetchBinaries.default(os.platform(), gsPath);

    if (os.platform() === 'linux') {
      console.log('setting permissions for binaries path');
      await exec(`chmod +x ${path.resolve(gsPath, '10.01.1_linux/usr/local/bin/gs')}`);
    }
  }
})();
