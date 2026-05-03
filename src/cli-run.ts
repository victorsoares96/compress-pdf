/* eslint-disable no-console */
import { runCli } from './cli';

runCli(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
