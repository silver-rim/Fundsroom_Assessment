/**
 * Copies non-TypeScript build assets into dist/ after `tsc` runs.
 *
 * `tsc` only emits .js for .ts inputs, so the .sql migration files would be
 * missing from a production build and `npm run migrate:prod` would find an
 * empty migrations directory. Node's fs.cpSync keeps this cross-platform
 * (a `cp -r` in package.json would not run on Windows).
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const assets = [{ from: join('src', 'db', 'migrations'), to: join('dist', 'db', 'migrations') }];

for (const asset of assets) {
  const source = join(backendRoot, asset.from);
  const target = join(backendRoot, asset.to);

  if (!existsSync(source)) {
    console.error(`[copy-assets] missing source directory: ${asset.from}`);
    process.exit(1);
  }

  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`[copy-assets] ${asset.from} -> ${asset.to}`);
}
