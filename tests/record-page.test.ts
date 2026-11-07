import test from 'node:test';
import assert from 'node:assert/strict';
import { completeFirstLesson, createHarness, deferred } from './helpers/fakes';
import type { LearningApi } from '../src/domain/types';
import type { createRecordDetailController, RecordDetailState } from '../src/miniprogram/presenters/records';

type PageDefinition = {
  data: { view: RecordDetailState };
  controller: ReturnType<typeof createRecordDetailController> | null;
  onLoad(this: PageInstance, query: Record<string, string>): void;
  onShow(this: PageInstance): Promise<void>;
  onHide(this: PageInstance): void;
  confirmDelete(this: PageInstance): void;
};
type PageInstance = PageDefinition & { setData(data: Record<string, unknown>): void };

test('record page keeps pending deletion across hide/show and clears it on account change', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  await h.repository.transaction(async tx => {
    const stored = await tx.get<Record<string, unknown>>('practices', record.id);
    await tx.set('practices', record.id, { ...stored, lessonVersion: 7 });
  });
  const previousPage = (globalThis as { Page?: unknown }).Page;
  const previousWx = (globalThis as { wx?: unknown }).wx;
  const previousEnv = (globalThis as { __CLOUD_ENV_ID__?: unknown }).__CLOUD_ENV_ID__;
  let definition: PageDefinition | undefined;
  let current: LearningApi = h.apiA;
  let holdDeleteReply = false;
  let held = false;
  const deleteFinished = deferred<void>();
  const releaseReply = deferred<void>();
  (globalThis as { __CLOUD_ENV_ID__?: unknown }).__CLOUD_ENV_ID__ = 'test-env';
  (globalThis as { Page?: unknown }).Page = (value: PageDefinition) => { definition = value; };
  (globalThis as { wx?: unknown }).wx = { showModal: ({ success }: { success: (result: { confirm: boolean }) => void }) =>
    success({ confirm: true }), cloud: { callFunction: async ({ data }: {
    data: { action: 'getRecord' | 'getPlayback' | 'deleteRecord'; input: { id: string } },
  }) => {
    try {
      const result = await current[data.action](data.input.id);
      if (data.action === 'deleteRecord' && holdDeleteReply && !held) {
        held = true;
        deleteFinished.resolve();
        await releaseReply.promise;
      }
      return { result: { ok: true, data: result } };
    }
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
    assert.equal(page.data.view.record?.lessonVersion, 7);
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

    const racing = await completeFirstLesson(h);
    const secondPage: PageInstance = { ...definition, data: { ...definition.data },
      setData(data) { Object.assign(this.data, data); } };
    secondPage.onLoad.call(secondPage, { id: racing.id });
    await secondPage.onShow.call(secondPage);
    h.files.removeFailure = new Error('storage offline again');
    holdDeleteReply = true;
    secondPage.confirmDelete.call(secondPage);
    await deleteFinished.promise;
    secondPage.onHide.call(secondPage);
    await secondPage.onShow.call(secondPage);
    assert.equal(secondPage.data.view.phase, 'deleting');
    releaseReply.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(secondPage.data.view.phase, 'deleting');
  } finally {
    (globalThis as { Page?: unknown }).Page = previousPage;
    (globalThis as { wx?: unknown }).wx = previousWx;
    (globalThis as { __CLOUD_ENV_ID__?: unknown }).__CLOUD_ENV_ID__ = previousEnv;
  }
});
