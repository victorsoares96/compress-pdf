const os = require('os');
const fs = require('fs');
const path = require('path');

(async () => {
  if (fs.existsSync(path.resolve(__dirname, '../dist'))) {
    const fetchBinaries = require('compress-pdf/dist/fetch-binaries');
    await fetchBinaries(os.platform(), path.resolve(__dirname, '../bin/gs'));
  }
})();
