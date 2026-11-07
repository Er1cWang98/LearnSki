import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const dist = resolve(root, 'dist');
const miniSource = join(root, 'src', 'miniprogram');
const miniOutput = join(dist, 'miniprogram');
const serverSource = join(root, 'src', 'server');

if (dirname(dist) !== root) throw new Error('Invalid dist path');
if (existsSync(dist)) {
  const stat = await lstat(dist);
  if (stat.isSymbolicLink()) throw new Error('Refusing to clean symlinked dist');
  const actual = await realpath(dist);
  if (!actual.startsWith(root + sep)) throw new Error('Dist path escapes workspace');
  await rm(dist, { recursive: true, force: true });
}

async function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

for (const file of await walk(miniSource)) {
  const destination = join(miniOutput, relative(miniSource, file));
  if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
    await mkdir(dirname(destination), { recursive: true });
    await build({
      entryPoints: [file],
      outfile: destination.slice(0, -3) + '.js',
      bundle: true,
      platform: 'browser',
      target: 'es2018',
      format: 'cjs',
    });
  } else if (/\.(json|wxml|wxss)$/.test(file)) {
    await mkdir(dirname(destination), { recursive: true });
    await cp(file, destination);
  }
}

for (const [name, entry] of [
  ['learning', 'entry.ts'],
  ['maintenance', 'maintenance-entry.ts'],
]) {
  const source = join(serverSource, entry);
  if (!existsSync(source)) continue;
  const output = join(dist, 'cloudfunctions', name);
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: [source],
    outfile: join(output, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['wx-server-sdk'],
  });
  await writeFile(join(output, 'package.json'), JSON.stringify({
    name: `learnski-${name}`,
    version: '0.1.0',
    private: true,
    main: 'index.js',
    dependencies: { 'wx-server-sdk': '4.0.2' },
  }, null, 2) + '\n');
}
