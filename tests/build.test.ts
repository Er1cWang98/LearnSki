import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const dist = resolve('dist');
const mini = join(dist, 'miniprogram');

test('every registered page and cloud function is deployable from the build output', async () => {
  const app = JSON.parse(await readFile(join(mini, 'app.json'), 'utf8'));
  const project = JSON.parse(await readFile(join(dist, 'project.config.json'), 'utf8'));
  assert.equal(app.pages.length, 5);
  assert.equal(app.tabBar.list.length, 2);
  assert.equal(project.miniprogramRoot, 'miniprogram/');
  assert.equal(project.cloudfunctionRoot, 'cloudfunctions/');
  for (const page of app.pages as string[]) {
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      await access(join(mini, `${page}.${extension}`));
    }
  }
  for (const name of ['learning', 'maintenance']) {
    const folder = join(dist, 'cloudfunctions', name);
    const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'index.js');
    assert.equal(manifest.dependencies['wx-server-sdk'], '4.0.2');
    assert.equal(manifest.dependencies['@cloudbase/node-sdk'], '3.17.2');
    const probe = spawnSync(process.execPath, ['-e', [
      "const Module = require('node:module');",
      'const load = Module._load;',
      "Module._load = function(name, ...args) { return name === 'wx-server-sdk' ? {} : load.call(this, name, ...args); };",
      "if (typeof require(process.argv[1]).main !== 'function') process.exit(1);",
    ].join('\n'), join(folder, 'index.js')], { encoding: 'utf8' });
    assert.equal(probe.status, 0, `${name} failed to load: ${probe.stderr}`);
  }
  const triggers = JSON.parse(await readFile(join(dist, 'cloudfunctions', 'maintenance', 'config.json'), 'utf8'));
  assert.equal(triggers.triggers.length, 1);
  assert.equal(triggers.triggers[0].type, 'timer');
});

test('client bundle excludes server modules and private configuration', async () => {
  const files = await readdir(mini, { recursive: true });
  for (const file of files) {
    assert.doesNotMatch(file, /(?:cloud\.local|database\.rules|storage\.rules|maintenance\.trigger)/);
    if (!/\.(js|json|wxml|wxss)$/.test(file)) continue;
    const contents = await readFile(join(mini, file), 'utf8');
    assert.doesNotMatch(contents, /node:crypto|wx-server-sdk|@cloudbase\/node-sdk|FILE_ID_PREFIX|TRIGGER_SRC/);
  }
});
