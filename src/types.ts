export type Resolution =
  | 'screen'
  | 'ebook'
  | 'printer'
  | 'prepress'
  | 'default';

export type Options = {
  compatibilityLevel?: number;
  resolution?: Resolution;
  /**
   * The path for ghostscript binary directory.
   */
  binPath?: string;
};
