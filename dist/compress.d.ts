import { Options } from './types.js';

declare function compress(file: string | Buffer, options?: Options): Promise<Buffer<ArrayBufferLike>>;

export { compress as default };
