import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { BUDGETS, DEFERRED_PAGES, checkWebBundle } from "./check-web-bundle.mjs";

// Representative Vite output: a diamond plus a cycle ensures shared static
// chunks are counted once; large dynamic chunks must not count at all.
async function fixture(t, change = () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "web-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logo = "assets/large_virtual_studio_globe_logo-abc.webp";
  const manifest = {
    "index.html": {
      file: "assets/index.js", isEntry: true,
      imports: ["_a.js", "_b.js"], assets: [logo],
      dynamicImports: DEFERRED_PAGES.map((page) => `src/pages/${page}.tsx`),
    },
    "_a.js": { file: "assets/a.js", imports: ["_shared.js"] },
    "_b.js": { file: "assets/b.js", imports: ["_shared.js"] },
    "_shared.js": { file: "assets/shared.js", imports: ["_a.js"] },
  };
  const modules = {
    "assets/index.js": ["client/src/App.tsx", "client/src/pages/Home.tsx"],
    "assets/a.js": ["client/src/a.ts"],
    "assets/b.js": ["client/src/b.ts"],
    "assets/shared.js": ["client/src/shared.ts"],
  };
  const files = Object.fromEntries(Object.keys(modules).map((file) => [file, "const a=1;"]));
  files[logo] = Buffer.alloc(99_060);
  for (const page of DEFERRED_PAGES) {
    const file = `assets/${page}.js`;
    manifest[`src/pages/${page}.tsx`] = { file, isDynamicEntry: true };
    modules[file] = [`client/src/pages/${page}.tsx`];
    files[file] = Buffer.alloc(1_000_000);
  }
  change({ manifest, modules, files, logo });
  await mkdir(path.join(directory, ".vite"), { recursive: true });
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, ".vite/manifest.json"), JSON.stringify(manifest)),
    writeFile(path.join(directory, ".vite/chunk-modules.json"), JSON.stringify(modules)),
    ...Object.entries(files).map(([file, content]) => writeFile(path.join(directory, file), content)),
  ]);
  return directory;
}

test("counts recursive static imports once and reports raw/gzip separately", async (t) => {
  const result = await checkWebBundle(await fixture(t));
  assert.equal(result.javascript.raw, 4 * Buffer.byteLength("const a=1;"));
  assert.equal(result.javascript.gzip, 4 * gzipSync("const a=1;").length);
  assert.equal(result.logo.raw, 99_060);
  assert.equal(result.files.length, 4);
  assert.match(result.report, /uncompressed.*gzip/);
});

for (const page of DEFERRED_PAGES) {
  test(`rejects an eager ${page} merged into the entry`, async (t) => {
    const directory = await fixture(t, ({ manifest, modules }) => {
      modules["assets/index.js"].push(`client/src/pages/${page}.tsx`);
      delete manifest[`src/pages/${page}.tsx`];
      delete modules[`assets/${page}.js`];
    });
    await assert.rejects(checkWebBundle(directory), new RegExp(`${page} is in the initial static`));
  });
}

test("rejects a deferred page imported transitively by a static chunk", async (t) => {
  const directory = await fixture(t, ({ manifest }) => {
    manifest["_shared.js"].imports.push("src/pages/Session.tsx");
  });
  await assert.rejects(checkWebBundle(directory), /Session is in the initial static/);
});

test("rejects oversized emitted logo even when highly compressible", async (t) => {
  const directory = await fixture(t, ({ files, logo }) => {
    files[logo] = Buffer.alloc(BUDGETS.logo.raw + 1);
  });
  await assert.rejects(checkWebBundle(directory), /logo raw: 110001 bytes exceeds 110000/);
});

test("rejects oversized recursively imported JavaScript", async (t) => {
  const directory = await fixture(t, ({ files }) => {
    files["assets/shared.js"] = Buffer.alloc(BUDGETS.javascript.raw);
  });
  await assert.rejects(checkWebBundle(directory), /javascript raw:.*exceeds 900000/);
});

test("enforces gzip budgets independently of raw budgets", async (t) => {
  const directory = await fixture(t);
  for (const kind of ["javascript", "logo"]) {
    await assert.rejects(checkWebBundle(directory, {
      ...BUDGETS, [kind]: { raw: BUDGETS[kind].raw, gzip: 1 },
    }), new RegExp(`${kind} gzip:.*exceeds 1 bytes`));
  }
});

test("accepts values exactly at both budgets", async (t) => {
  const directory = await fixture(t);
  const result = await checkWebBundle(directory);
  await checkWebBundle(directory, { javascript: result.javascript, logo: result.logo });
});

for (const [name, change, error] of [
  ["missing chunk", ({ manifest }) => { delete manifest["_shared.js"]; }, /Missing manifest chunk/],
  ["missing inventory", ({ modules }) => { delete modules["assets/a.js"]; }, /Missing module inventory/],
  ["missing logo", ({ manifest }) => { manifest["index.html"].assets = []; }, /Expected one emitted homepage logo/],
  ["missing asset file", ({ files, logo }) => { delete files[logo]; }, /ENOENT/],
  ["missing page", ({ modules }) => { delete modules["assets/Library.js"]; }, /Missing deferred page module/],
  ["missing dynamic entry", ({ manifest }) => { manifest["src/pages/Session.tsx"].isDynamicEntry = false; }, /must remain a dynamic entry/],
]) {
  test(`fails closed on ${name}`, async (t) => {
    await assert.rejects(checkWebBundle(await fixture(t, change)), error);
  });
}
