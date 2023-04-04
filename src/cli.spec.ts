/* eslint-disable @typescript-eslint/no-var-requires */
import util from 'node:util';

const exec = util.promisify(require('node:child_process').exec);

import('@/cli');

describe('cli', () => {
  it('should fail if name argument is not provided', async () => {
    const script = `npx tsx ${process.cwd()}/src/cli.ts`;

    const { stdout } = await exec(script);
    expect(stdout.trim()).toEqual('USE: npx say-my-name [NAME]');
  });

  it('should return name provided', async () => {
    const script = `npx tsx ${process.cwd()}/src/cli.ts Victor`;

    const { stdout } = await exec(script);
    expect(stdout.trim()).toEqual('Your name is Victor');
  });
});
