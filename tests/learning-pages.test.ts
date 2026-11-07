import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSession } from '../src/miniprogram/presenters/learning';
import type { Progress } from '../src/domain/types';

type PageDefinition = {
  data: Record<string, unknown>;
  onLoad?: (this: PageInstance, query: Record<string, string>) => void;
  onShow?: (this: PageInstance) => Promise<void>;
};
type PageInstance = PageDefinition & {
  setData: (data: Record<string, unknown>) => void;
};

const progress: Progress = {
  completedIds: ['intro-01'], requiredDone: 1, requiredTotal: 10,
  nextLessonId: 'intro-02', stageComplete: false,
};

function instance(definition: PageDefinition): PageInstance {
  return {
    ...definition,
    data: { ...definition.data },
    setData(data) { Object.assign(this.data, data); },
  };
}

test('learning page refreshes on every show and replaces unknown count only after scoped progress', async () => {
  const previousPage = (globalThis as { Page?: unknown }).Page;
  const previousGetApp = (globalThis as { getApp?: unknown }).getApp;
  let definition: PageDefinition | undefined;
  let requests = 0;
  const learning = createLearningSession({ getProgress: async () => {
    requests += 1;
    return { scope: 'account-a', progress };
  } });
  (globalThis as { Page?: unknown }).Page = (value: PageDefinition) => { definition = value; };
  (globalThis as { getApp?: unknown }).getApp = () => ({ globalData: { learning } });
  try {
    await import('../src/miniprogram/pages/learn/index');
    assert.ok(definition);
    const page = instance(definition);
    assert.equal((page.data.route as { completedText: string }).completedText, '— / 10');
    await page.onShow?.call(page);
    assert.equal((page.data.route as { completedText: string }).completedText, '1 / 10');
    assert.equal((page.data.route as { continueLessonId: string }).continueLessonId, 'intro-02');
    await page.onShow?.call(page);
    assert.equal(requests, 2);
  } finally {
    (globalThis as { Page?: unknown }).Page = previousPage;
    (globalThis as { getApp?: unknown }).getApp = previousGetApp;
  }
});

test('lesson page leaves a later lesson in preview while cloud progress is unknown', async () => {
  const previousPage = (globalThis as { Page?: unknown }).Page;
  const previousGetApp = (globalThis as { getApp?: unknown }).getApp;
  let definition: PageDefinition | undefined;
  const learning = createLearningSession({ getProgress: async () => { throw { code: 'NETWORK_ERROR' }; } });
  (globalThis as { Page?: unknown }).Page = (value: PageDefinition) => { definition = value; };
  (globalThis as { getApp?: unknown }).getApp = () => ({ globalData: { learning } });
  try {
    await import('../src/miniprogram/pages/lesson/index');
    assert.ok(definition);
    const page = instance(definition);
    page.onLoad?.call(page, { id: 'intro-02' });
    await page.onShow?.call(page);
    assert.equal((page.data.view as { status: string }).status, 'unknown');
    assert.equal((page.data.view as { showFullContent: boolean }).showFullContent, false);
  } finally {
    (globalThis as { Page?: unknown }).Page = previousPage;
    (globalThis as { getApp?: unknown }).getApp = previousGetApp;
  }
});
