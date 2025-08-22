import { Options } from './types.mjs';

declare function compress(file: string | Buffer, options?: Options): Promise<Buffer<ArrayBufferLike>>;

export { compress as default };
