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

### Enforced production budgets

Every `npm run build` checks the actual Vite output before building the server.
The existing build validation and GitHub jobs therefore enforce these limits
without changing any required status names. `npm run check:bundle` rechecks an
existing `dist/public`; it fails if build metadata or referenced files are missing.

| Resource | Uncompressed limit | Gzip limit |
| --- | ---: | ---: |
| Initial JavaScript (all static dependencies) | 900,000 bytes | 255,000 bytes |
| Homepage logo | 110,000 bytes | 110,000 bytes |

The limits leave roughly 6–11% headroom above the measured baseline rather than
accepting the earlier megabyte-sized logo or unsplit entry. Both limits are
independently enforced; a highly compressible oversized file still fails.
Gzip uses Node's default gzip settings, separately for each emitted resource,
and is reported separately from uncompressed bytes. This measures compression
potential, not actual server transfer encoding.

The checker starts at `index.html` in Vite's manifest, recursively follows only
static `imports`, and counts each output file once. Dynamic imports are excluded.
A build-only plugin records module membership per output chunk; Library, Session,
and RemoteControl must exist as dynamic entries and none of their source modules
may appear in any initial chunk, even if an eager import merges them into the
entry or a shared dependency. The logo is located among the initial graph's
emitted assets by its source basename, so its hashed name and image extension
can change without bypassing the budget. Renaming or inlining it fails closed
and requires an intentional update to this contract.

`npm run test:bundle` exercises synthetic Vite output fixtures, including eager
routes merged into the entry, transitive eager routes, shared/cyclic static
imports, oversized images and JavaScript, independent gzip limits, exact
boundaries, and missing metadata/files. These tests also run through the existing
`test:workflows` validation command. To intentionally raise a limit, edit
`BUDGETS` in `scripts/check-web-bundle.mjs` and document the reason here; do not
raise Vite's warning threshold as a substitute.

### Original optimization checks

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
