type Resolution = 'screen' | 'ebook' | 'printer' | 'prepress' | 'default';
type Options = {
    compatibilityLevel?: number;
    /**
     * Can be
     *
     * `screen` selects low-resolution output similar to the Acrobat Distiller (up to version X) "Screen Optimized" setting.
     *
     * `ebook` selects medium-resolution output similar to the Acrobat Distiller (up to version X) "eBook" setting.
     *
     * `printer` selects output similar to the Acrobat Distiller "Print Optimized" (up to version X) setting.
     *
     * `prepress` selects output similar to Acrobat Distiller "Prepress Optimized" (up to version X) setting.
     *
     * `default` selects output intended to be useful across a wide variety of uses, possibly at the expense of a larger output file.
     *
     * Default is `ebook`
     */
    resolution?: Resolution;
    /**
     * Set quality of pdf images.
     * Default is `100`
     */
    imageQuality?: number;
    /**
     * The path for ghostscript binary directory.
     *
     * `You can download binaries in releases section inside any version of this repository.`
     */
    gsModule?: string;
    /**
     * The pdf password
     */
    pdfPassword?: string;
    /**
     * Remove password of a protected pdf, after compression
     */
    removePasswordAfterCompression?: boolean;
};

export type { Options, Resolution };
