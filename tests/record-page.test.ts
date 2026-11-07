import test from 'node:test';
import assert from 'node:assert/strict';
import { completeFirstLesson, createHarness } from './helpers/fakes';
import type { LearningApi } from '../src/domain/types';
import type { createRecordDetailController, RecordDetailState } from '../src/miniprogram/presenters/records';

type PageDefinition = {
  data: { view: RecordDetailState };
  controller: ReturnType<typeof createRecordDetailController> | null;
  onLoad(this: PageInstance, query: Record<string, string>): void;
  onShow(this: PageInstance): Promise<void>;
  onHide(this: PageInstance): void;
};
type PageInstance = PageDefinition & { setData(data: Record<string, unknown>): void };

test('record page keeps pending deletion across hide/show and clears it on account change', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  const previousPage = (globalThis as { Page?: unknown }).Page;
  const previousWx = (globalThis as { wx?: unknown }).wx;
  const previousEnv = (globalThis as { __CLOUD_ENV_ID__?: unknown }).__CLOUD_ENV_ID__;
  let definition: PageDefinition | undefined;
  let current: LearningApi = h.apiA;
  (globalThis as { __CLOUD_ENV_ID__?: unknown }).__CLOUD_ENV_ID__ = 'test-env';
  (globalThis as { Page?: unknown }).Page = (value: PageDefinition) => { definition = value; };
  (globalThis as { wx?: unknown }).wx = { cloud: { callFunction: async ({ data }: {
    data: { action: 'getRecord' | 'getPlayback' | 'deleteRecord'; input: { id: string } },
  }) => {
    try { return { result: { ok: true, data: await current[data.action](data.input.id) } }; }
    catch (error) { return { result: { ok: false, error: { code: (error as { code: string }).code,
      message: '内容不存在' } } }; }
  } } };
  try {
    await import('../src/miniprogram/pages/record/index');
    assert.ok(definition);
    const page: PageInstance = { ...definition, data: { ...definition.data },
      setData(data) { Object.assign(this.data, data); } };
    page.onLoad.call(page, { id: record.id });
    await page.onShow.call(page);
    assert.equal(page.data.view.phase, 'ready');
    h.files.removeFailure = new Error('storage offline');
    assert.deepEqual(await page.controller!.remove(), { state: 'deleting' });
    assert.equal(page.data.view.phase, 'deleting');

    page.onHide.call(page);
    await page.onShow.call(page);
    assert.equal(page.data.view.phase, 'deleting');

    current = h.apiB;
    page.onHide.call(page);
    await page.onShow.call(page);
    assert.equal(page.data.view.phase, 'error');
    assert.equal(page.data.view.record, null);
    assert.equal(page.data.view.playbackUrl, '');

    current = h.apiA;
    h.files.removeFailure = null;
    page.onHide.call(page);
    await page.onShow.call(page);
    assert.equal(page.data.view.phase, 'deleted');
    assert.equal((await h.apiA.getProgress()).progress.requiredDone, 1);
  } finally {
    (globalThis as { Page?: unknown }).Page = previousPage;
    (globalThis as { wx?: unknown }).wx = previousWx;
    (globalThis as { __CLOUD_ENV_ID__?: unknown }).__CLOUD_ENV_ID__ = previousEnv;
  }
});
