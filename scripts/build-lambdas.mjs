import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const lambdas = [
  'events-handler',
  'registrations-handler',
  'files-handler',
  'auth-postConfirmation',
  'email-handler',
];

const target = process.argv[2]; // optional: build a single lambda

const toBuild = target ? [target] : lambdas;

if (target && !lambdas.includes(target)) {
  console.error(`Unknown lambda "${target}". Valid options: ${lambdas.join(', ')}`);
  process.exit(1);
}

rmSync(resolve(root, 'dist/lambdas'), { recursive: true, force: true });
rmSync(resolve(root, 'dist/*.zip'), { force: true });
mkdirSync(resolve(root, 'dist/lambdas'), { recursive: true });

for (const lambda of toBuild) {
  const outDir = resolve(root, `dist/lambdas/${lambda}`);
  const zipPath = resolve(root, `dist/${lambda}.zip`);

  mkdirSync(outDir, { recursive: true });

  console.log(`\nBuilding ${lambda}...`);

  await esbuild.build({
    entryPoints: [resolve(root, `src/lambdas/${lambda}/handler.ts`)],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: resolve(outDir, 'index.js'),
    minify: false,
    sourcemap: false,
    // pg uses dynamic requires internally — this suppresses the warning
    packages: 'bundle',
  });

  execSync(`cd "${outDir}" && zip -r "${zipPath}" index.js`, { stdio: 'inherit' });
  console.log(`✓  dist/${lambda}.zip`);
}

console.log('\nBuild complete.');
