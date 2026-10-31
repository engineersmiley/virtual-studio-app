# Initial web download size

Measured with `npm run build` on the same dependency installation before and
after the changes below. Sizes are decimal kB as reported by Vite, not KiB.

| Production output | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Initial JavaScript, minified | 1,043.09 kB | 846.83 kB | 18.8% |
| Initial JavaScript, gzip | 290.60 kB | 237.73 kB | 18.2% |
| Landing-page logo | 1,102.58 kB | 99.06 kB | 91.0% |
| Initial JavaScript + logo, uncompressed | 2,145.67 kB | 945.89 kB | 55.9% |
| CSS, minified | 85.41 kB | 85.41 kB | unchanged |
| CSS, gzip | 13.90 kB | 13.90 kB | unchanged |

These figures exclude HTML, fonts, API responses, and other existing public
assets. Gzip figures describe compression potential, not a guarantee that the
hosting server sends gzip.

## Changes

- Keep Home and the shared app providers eager. Use `React.lazy` for Library,
  Session, and RemoteControl, with an accessible loading status during navigation
  or a direct visit. Paths, page components, and page behavior remain unchanged.
- Vite emits separate page chunks: Library 25.15 kB, RemoteControl 26.32 kB,
  Session 144.38 kB, plus small shared chunks. They are downloaded when their
  page is visited, not by the initial landing page.
- Convert the 1024 × 1024 PNG logo to a 1024 × 1024 WebP at quality 90, stripping
  metadata. Keep the original PNG as the source asset; only the WebP is imported
  by the client and emitted in production. Layout, image size, and alt text are
  unchanged.

The Vite chunk warning threshold is unchanged. The remaining 846.83 kB entry
still produces a warning. Route splitting reduces the initial transfer rather
than reducing the total JavaScript needed if someone visits every page.

## Verification

- `npm run check` and `npm test` pass.
- Production output has dynamic imports for all three deferred pages and their
  referenced chunks exist; the entry references WebP instead of the PNG.
- The development app starts and the landing page renders.

To reproduce the image conversion with ImageMagick:

```sh
magick attached_assets/generated_images/large_virtual_studio_globe_logo.png \
  -strip -quality 90 \
  attached_assets/generated_images/large_virtual_studio_globe_logo.webp
```
