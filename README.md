# compress-pdf

This library provides compress your PDFs using ghostscript

## Requirements

Download ghostscript binaries available in releases page inside this repository. Example name: `gs_10.01.linux/windows.zip`

Then, extract and appoint:

```sh
npm install gsx-pdf-optimize --global
```

### Code Usage

```tsx
import * as React from 'react';

import { SafeAreaView, useWindowDimensions } from 'react-native';
import { Reader, ReaderProvider } from '@epubjs-react-native/core';
// import { useFileSystem } from '@epubjs-react-native/file-system'; // for Bare React Native project
// import { useFileSystem } from '@epubjs-react-native/expo-file-system'; // for Expo project

export default function App() {
  const { width, height } = useWindowDimensions();
  return (
    <SafeAreaView>
      <ReaderProvider>
        <Reader
          src="https://s3.amazonaws.com/moby-dick/OPS/package.opf"
          width={width}
          height={height}
          fileSystem={useFileSystem}
        />
      </ReaderProvider>
    </SafeAreaView>
  );
}
```

## CLI Usage

```
gsx-pdf-optimize input.pdf [output.pdf] [opts]

Options:
  --preset, -P   one of: screen (default), printer, prepress, ebook
  --dpi, -D      image resampling resolution in DPI, default 300
  --quiet        enable or disable logging (default quiet=true)
  --command      the Ghostscript command to use, default gsx
```

You can also override the command with the GSX_OPTIMIZE_COMMAND env var, e.g. if you want to set that in your bash profile.

Examples:

```sh
gsx-pdf-optimize input.pdf
gsx-pdf-optimize input.pdf output.pdf
gsx-pdf-optimize input.pdf --preset=ebook --dpi=96
GSX_OPTIMIZE_COMMAND=gs gsx-pdf-optimize input.pdf output.pdf
```

## Raw Command

Below is the raw command if you'd like to optimize it further yourself. Credit goes to @lkraider and [this gist](https://gist.github.com/lkraider/f0888da30bc352f9d167dfa4f4fc8213).

```sh
gsx -sDEVICE=pdfwrite \
  -dPDFSETTINGS=/screen \
  -dNOPAUSE -dQUIET -dBATCH \
  -dCompatibilityLevel=1.5 \
  `# font settings` \
  -dSubsetFonts=true \
  -dCompressFonts=true \
  -dEmbedAllFonts=true \
  `# color format` \
  -sProcessColorModel=DeviceRGB \
  -sColorConversionStrategy=RGB \
  -sColorConversionStrategyForImages=RGB \
  -dConvertCMYKImagesToRGB=true \
  `# image resample` \
  -dDetectDuplicateImages=true \
  -dColorImageDownsampleType=/Bicubic \
  -dColorImageResolution=300 \
  -dGrayImageDownsampleType=/Bicubic \
  -dGrayImageResolution=300 \
  -dMonoImageDownsampleType=/Bicubic \
  -dMonoImageResolution=300 \
  -dDownsampleColorImages=true \
  `# preset overrides` \
  -dDoThumbnails=false \
  -dCreateJobTicket=false \
  -dPreserveEPSInfo=false \
  -dPreserveOPIComments=false \
  -dPreserveOverprintSettings=false \
  -dUCRandBGInfo=/Remove \
  -sOutputFile=output.pdf \
  input.pdf
```

## License

MIT, see [LICENSE.md](http://github.com/mattdesl/gsx-pdf-optimize/blob/master/LICENSE.md) for details.
