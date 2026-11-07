import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createFileStore, readVideoPrefix } from '../src/server/files';
import { createMain, main } from '../src/server/entry';
import * as fileAdapters from '../src/server/files';
import cloudbase from '@cloudbase/node-sdk';

const fileId = 'cloud://env.bucket/practice/a/s1/video';
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f32', 'hex');

test('file authorization fails closed on absent, denied, mismatched or unavailable proof', async () => {
  const path = 'practice/a/s1/video';
  await assert.rejects(createFileStore(cloud()).authorize('a', path), { code: 'VIDEO_INVALID' });
  for (const data of [undefined, [], [{ path, read: false }], [{ path: 'other', read: true }],
    [{ path, read: 'true' }], [{ path, read: true }, { path, read: true }]]) {
    const authorize = (fileAdapters as any).createOwnerAuthorization({ auth: () => ({ getUserInfo: () => ({ openId: 'a' }) }),
      getFileAuthority: async () => ({ data }) });
    await assert.rejects(authorize('a', path), { code: 'VIDEO_INVALID' });
  }
  for (const openId of ['', 'b']) {
    const authorize = (fileAdapters as any).createOwnerAuthorization({ auth: () => ({ getUserInfo: () => ({ openId }) }),
      getFileAuthority: async () => { throw new Error('must not request'); } });
    await assert.rejects(authorize('a', path), { code: 'VIDEO_INVALID' });
  }
  const authorize = (fileAdapters as any).createOwnerAuthorization({ auth: () => ({ getUserInfo: () => ({ openId: 'a' }) }),
    getFileAuthority: async () => { throw new Error('offline'); } });
  await assert.rejects(authorize('a', path), { code: 'VIDEO_INVALID' });
});

test('pinned node SDK authorization uses trusted context, exact READ path and instance environment', async () => {
  const transport = require('@cloudbase/node-sdk/dist/utils/tcbapirequester');
  const previousRequest = transport.request;
  const previousKeys = process.env.WX_CONTEXT_KEYS;
  const previousOpenid = process.env.WX_OPENID;
  const previousLogin = process.env.LOGINTYPE;
  const path = 'practice/a/s1/video';
  let creator = 'b';
  const requests: any[] = [];
  process.env.WX_CONTEXT_KEYS = 'WX_OPENID'; process.env.WX_OPENID = 'a'; process.env.LOGINTYPE = 'WECHAT';
  transport.request = async (request: any) => {
    requests.push(request);
    return { data: [{ path, cosFileId: 'provider-object', read: request.params.openId === creator }] };
  };
  try {
    const app = cloudbase.init({ env: 'test-env' });
    const authorize = (fileAdapters as any).createOwnerAuthorization(app);
    await assert.rejects(authorize('a', path), { code: 'VIDEO_INVALID' });
    creator = 'a';
    await authorize('a', path);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].config.envName, 'test-env');
    assert.deepEqual(requests[0].params, { action: 'storage.getFileAuthority', openId: 'a', uid: '',
      loginType: 'WECHAT', fileList: [{ path, type: 'READ' }] });
  } finally {
    transport.request = previousRequest;
    for (const [key, value] of [['WX_CONTEXT_KEYS', previousKeys], ['WX_OPENID', previousOpenid], ['LOGINTYPE', previousLogin]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

function cloud(status = 0, url = 'https://storage.example/video') {
  return {
    getTempFileURL: async () => ({ fileList: [{ fileID: fileId, tempFileURL: url, maxAge: 300,
      status, errMsg: status ? 'missing' : 'ok' }] }),
    deleteFile: async () => ({ fileList: [{ fileID: fileId, status, errMsg: status ? 'missing' : 'ok' }] }),
  };
}

test('inspect accepts a supported MP4 brand and trusted total length', async () => {
  const files = createFileStore(cloud() as any, async () => ({ status: 206,
    headers: { 'content-range': 'bytes 0-23/104857600' }, prefix: mp4 }));
  assert.deepEqual(await files.inspect(fileId), { bytes: 104857600, video: true });
});

test('inspect accepts a long ftyp box when its first 64 bytes identify MP4', async () => {
  const prefix = Buffer.alloc(64);
  prefix.writeUInt32BE(100, 0);
  prefix.write('ftyp', 4, 'ascii');
  prefix.write('isom', 8, 'ascii');
  const files = createFileStore(cloud() as any, async () => ({ status: 206,
    headers: { 'content-range': 'bytes 0-63/1024' }, prefix }));
  assert.deepEqual(await files.inspect(fileId), { bytes: 1024, video: true });
});

test('inspect rejects HTML, unsupported brands and untrusted lengths', async () => {
  const cases = [
    { prefix: Buffer.from('<!doctype html>'), status: 200, headers: { 'content-length': '1024' } },
    { prefix: Buffer.from('00000018667479706261642000000200', 'hex'), status: 206,
      headers: { 'content-range': 'bytes 0-15/1024' } },
    { prefix: mp4, status: 200, headers: {} },
    { prefix: mp4, status: 206, headers: { 'content-range': 'bytes 0-23/*' } },
    { prefix: mp4, status: 206, headers: { 'content-range': 'bytes 0-23/104857601' } },
    { prefix: mp4, status: 206, headers: { 'content-range': 'bytes 100-123/1024' } },
    { prefix: mp4, status: 302, headers: { location: 'https://elsewhere.example' } },
  ];
  for (const response of cases) {
    const files = createFileStore(cloud() as any, async () => response);
    await assert.rejects(files.inspect(fileId), { code: 'VIDEO_INVALID' });
  }
});

test('inspect rejects an SDK missing file and a non-HTTPS URL', async () => {
  await assert.rejects(createFileStore(cloud(-503003) as any, async () => { throw new Error('unexpected request'); })
    .inspect(fileId), { code: 'VIDEO_REQUIRED' });
  await assert.rejects(createFileStore(cloud(0, 'http://storage.example/video') as any,
    async () => { throw new Error('unexpected request'); }).inspect(fileId), { code: 'VIDEO_INVALID' });
});

test('playback requests a five minute URL and checks per-file status', async () => {
  let options: unknown;
  const sdk = { getTempFileURL: async (input: unknown) => {
    options = input;
    return cloud().getTempFileURL();
  } };
  const files = createFileStore(sdk as any, async () => { throw new Error('unexpected request'); }, () => 1000);
  assert.deepEqual(await files.playback(fileId), { url: 'https://storage.example/video', expiresAt: 301000 });
  assert.deepEqual(options, { fileList: [{ fileID: fileId, maxAge: 300 }] });
  await assert.rejects(createFileStore(cloud(-503003) as any).playback(fileId), { code: 'NOT_FOUND' });
});

test('playback expiry honors a shorter SDK maxAge', async () => {
  const sdk = { getTempFileURL: async () => ({ fileList: [{ fileID: fileId,
    tempFileURL: 'https://storage.example/video', maxAge: 120, status: 0, errMsg: 'ok' }] }) };
  const result = await createFileStore(sdk as any, undefined, () => 1000).playback(fileId);
  assert.equal(result.expiresAt, 121000);
});

test('remove treats only the known missing-file status as idempotent', async () => {
  await createFileStore(cloud(-503003) as any).remove(fileId);
  await assert.rejects(createFileStore(cloud(-503002) as any).remove(fileId));
});

test('HTTP reader caps copied bytes and closes the response', async t => {
  const from = Buffer.from;
  const copied: number[] = [];
  t.mock.method(Buffer, 'from', (...args: any[]) => {
    if (Buffer.isBuffer(args[0])) copied.push(args[0].length);
    return Reflect.apply(from, Buffer, args);
  });
  let requestOptions: any;
  const response = new PassThrough() as PassThrough & { statusCode?: number; headers?: Record<string, string> };
  response.statusCode = 200;
  response.headers = { 'content-length': '1000' };
  const get = ((_url: string, options: any, callback: (incoming: typeof response) => void) => {
    requestOptions = options;
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = () => {};
    queueMicrotask(() => { callback(response); response.write(Buffer.alloc(1000, 1)); });
    return req;
  }) as any;
  const result = await readVideoPrefix('https://storage.example/video', get);
  assert.equal(result.prefix.length, 64);
  assert.equal(response.destroyed, true);
  assert.equal(requestOptions.headers.Range, 'bytes=0-63');
  assert.equal(requestOptions.timeout, 10000);
  assert.ok(copied.every(bytes => bytes <= 64), `copied oversized chunks: ${copied}`);
});

test('HTTP reader rejects redirects without following them', async () => {
  let calls = 0;
  const get = ((_url: string, _options: unknown, callback: (response: any) => void) => {
    calls++;
    const response = new PassThrough() as PassThrough & { statusCode?: number; headers?: Record<string, string> };
    response.statusCode = 302;
    response.headers = { location: 'https://elsewhere.example' };
    const req = new EventEmitter() as EventEmitter & { destroy: () => void };
    req.destroy = () => {};
    queueMicrotask(() => { callback(response); response.end(); });
    return req;
  }) as any;
  await assert.rejects(readVideoPrefix('https://storage.example/video', get), { code: 'VIDEO_INVALID' });
  assert.equal(calls, 1);
});

test('production handler initializes current environment and uses trusted OpenID', async () => {
  const calls: unknown[] = [];
  const marker = Symbol('current-env');
  const query: any = { where() { return this; }, orderBy() { return this; }, limit() { return this; },
    async get() { return { data: [] }; } };
  const sdk = { DYNAMIC_CURRENT_ENV: marker, init(input: unknown) { calls.push(input); },
    getWXContext() { return { OPENID: 'trusted-user', ENV: 'test-env' }; },
    database() { return { collection() { return query; } }; },
    getTempFileURL: cloud().getTempFileURL, deleteFile: cloud().deleteFile };
  const initialized: unknown[] = [];
  const handler = createMain(sdk as any, { FILE_ID_PREFIX: 'cloud://test-env.bucket' }, {
    ...cloudbase, init(options) { initialized.push(options); return cloudbase.init(options); },
  });
  const result = await handler({ action: 'getProgress', input: { ownerId: 'attacker' } });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal((result.data as any).progress.requiredDone, 0);
  assert.deepEqual(calls, [{ env: marker }]);
  assert.deepEqual(initialized, [{ env: 'test-env' }]);
  assert.equal(typeof main, 'function');
});

test('production handler fails closed for a missing or mismatched file prefix', async () => {
  const sdk = { DYNAMIC_CURRENT_ENV: Symbol('current-env'), init() {},
    getWXContext() { return { OPENID: 'trusted-user', ENV: 'test-env' }; } };
  for (const prefix of [undefined, 'cloud://other-env.bucket', 'cloud://test-env.bucket/practice']) {
    const result = await createMain(sdk as any, { FILE_ID_PREFIX: prefix })({ action: 'getProgress', input: {} });
    assert.deepEqual(result, { ok: false, error: { code: 'CLOUD_UNAVAILABLE', message: '云服务暂不可用' } });
  }
});
