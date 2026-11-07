import { lessons } from '../../../catalog/intro';
import type { PracticeRecord } from '../../../domain/types';
import { toRouteView } from '../../presenters/learning';
import type { LearningSession } from '../../presenters/learning';
import { createRecordsController } from '../../presenters/records';
import type { RecordsState } from '../../presenters/records';
import { createApi } from '../../services/cloud';

declare const __CLOUD_ENV_ID__: string;
const api = createApi(__CLOUD_ENV_ID__);
type LearningApp = { globalData: { learning: LearningSession } };
type Controller = ReturnType<typeof createRecordsController>;
const filterOptions = [{ id: '', title: '全部课程' }, ...lessons.map(({ id, title }) => ({ id, title }))];
const titleById = new Map(lessons.map(lesson => [lesson.id, lesson.title]));

function row(record: PracticeRecord) {
  const date = new Date(record.createdAt);
  return { ...record, title: titleById.get(record.lessonId) ?? '课程',
    dateText: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`,
    resultText: record.result === 'selfCompleted' ? '自评完成' : '练习中' };
}

Page({
  controller: null as Controller | null,
  epoch: 0,
  data: {
    route: toRouteView(null, false),
    filterOptions,
    filterIndex: 0,
    records: { phase: 'loading', items: [], nextCursor: null, totalActive: null, error: null,
      loadingMore: false, moreError: null } as RecordsState,
    rows: [] as ReturnType<typeof row>[],
  },
  async onShow() {
    const epoch = ++this.epoch;
    const session = getApp<LearningApp>().globalData.learning;
    this.setData({ route: toRouteView(session.state.progress, session.state.stale) });
    this.controller = createRecordsController(api, records => {
      if (epoch === this.epoch) this.setData({ records, rows: records.items.map(row) });
    });
    const selected = filterOptions[this.data.filterIndex];
    const load = this.controller.load(selected?.id || undefined);
    const refresh = session.refresh();
    await Promise.all([load, refresh]);
    if (epoch === this.epoch) this.setData({ route: toRouteView(session.state.progress, session.state.stale) });
  },
  onHide() { ++this.epoch; this.controller = null; },
  onUnload() { ++this.epoch; this.controller = null; },
  changeFilter(event: { detail: { value: string } }) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !filterOptions[index]) return;
    this.setData({ filterIndex: index });
    void this.controller?.load(filterOptions[index].id || undefined);
  },
  retryLoad() { void this.controller?.load(filterOptions[this.data.filterIndex].id || undefined); },
  loadMore() { void this.controller?.loadMore(); },
  openRecord(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.id as string;
    if (id) wx.navigateTo({ url: `/pages/record/index?id=${encodeURIComponent(id)}` });
  },
  goLearn() { wx.switchTab({ url: '/pages/learn/index' }); },
});
