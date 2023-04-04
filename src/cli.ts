/* eslint-disable no-console */
import { sayMyName } from '@/sayMyName';

(() => {
  const name = process.argv[2];

  if (!name) console.log('USE: npx say-my-name [NAME]');
  else console.log(sayMyName({ name }));
})();
