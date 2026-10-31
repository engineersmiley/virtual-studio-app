import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// Decimal bytes. Keep changes intentional and document why a budget increases.
export const BUDGETS = {
  javascript: { raw: 900_000, gzip: 255_000 },
  logo: { raw: 110_000, gzip: 110_000 },
};
export const DEFERRED_PAGES = ["Library", "Session", "RemoteControl"];

export async function checkWebBundle(directory = "dist/public", budgets = BUDGETS) {
  const root = path.resolve(directory);
  const load = async (file) => {
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error(`Bundle path escapes output directory: ${file}`);
    }
    return readFile(resolved);
  };
  const manifest = JSON.parse(await load(".vite/manifest.json"));
  const modules = JSON.parse(await load(".vite/chunk-modules.json"));
  if (!manifest["index.html"]?.isEntry) {
    throw new Error("Missing Vite index.html entry");
  }

  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    const chunk = manifest[key];
    if (!chunk || !chunk.file) throw new Error(`Missing manifest chunk: ${key}`);
    initial.add(key);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit("index.html");
  const files = [...new Set([...initial].map((key) => manifest[key].file))];
  for (const file of files) {
    if (!Array.isArray(modules[file])) {
      throw new Error(`Missing module inventory for initial chunk: ${file}`);
    }
  }
  for (const page of DEFERRED_PAGES) {
    const source = `client/src/pages/${page}.tsx`;
    const containing = Object.entries(modules)
      .filter(([, ids]) => ids.includes(source))
      .map(([file]) => file);
    if (!containing.length) throw new Error(`Missing deferred page module: ${page}`);
    if (containing.some((file) => files.includes(file))) {
      throw new Error(`${page} is in the initial static dependency graph`);
    }
    const routeKey = `src/pages/${page}.tsx`;
    if (!manifest[routeKey]?.isDynamicEntry) {
      throw new Error(`${page} must remain a dynamic entry`);
    }
  }

  // Follow the assets referenced by the initial graph, not a hardcoded hashed
  // filename or the original source image (which isn't necessarily shipped).
  const logos = [...new Set([...initial].flatMap((key) => manifest[key].assets ?? []))]
    .filter((file) => /(?:^|\/)large_virtual_studio_globe_logo[-.]/.test(file));
  if (logos.length !== 1) {
    throw new Error(`Expected one emitted homepage logo; found ${logos.length}`);
  }
  const measure = async (paths) => {
    const sizes = await Promise.all(paths.map(async (file) => {
      const data = await load(file);
      return { raw: data.length, gzip: gzipSync(data).length };
    }));
    return sizes.reduce((total, size) => ({
      raw: total.raw + size.raw, gzip: total.gzip + size.gzip,
    }), { raw: 0, gzip: 0 });
  };
  const result = {
    javascript: await measure(files),
    logo: await measure(logos),
    files,
    logos,
  };
  const failures = [];
  for (const kind of ["javascript", "logo"]) {
    for (const encoding of ["raw", "gzip"]) {
      if (result[kind][encoding] > budgets[kind][encoding]) {
        failures.push(`${kind} ${encoding}: ${result[kind][encoding]} bytes exceeds ${budgets[kind][encoding]} bytes`);
      }
    }
  }
  const report = ["javascript", "logo"].map((kind) =>
    `${kind}: uncompressed ${result[kind].raw} bytes / ${budgets[kind].raw}; gzip ${result[kind].gzip} bytes / ${budgets[kind].gzip}`,
  ).join("\n");
  if (failures.length) throw new Error(`${report}\nBundle budget exceeded:\n${failures.join("\n")}`);
  return { ...result, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkWebBundle(process.argv[2]).then(
    ({ report }) => console.log(report),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
