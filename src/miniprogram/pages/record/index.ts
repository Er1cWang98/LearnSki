import { getLesson } from '../../../catalog/intro';
import { createRecordDetailController } from '../../presenters/records';
import type { RecordDetailState } from '../../presenters/records';
import { createApi } from '../../services/cloud';

declare const __CLOUD_ENV_ID__: string;
const api = createApi(__CLOUD_ENV_ID__);
type Controller = ReturnType<typeof createRecordDetailController>;

function detailView(state: RecordDetailState) {
  const record = state.record;
  let title = '';
  if (record) {
    try { title = getLesson(record.lessonId).title; }
    catch { title = '课程练习'; }
  }
  const date = record ? new Date(record.createdAt) : null;
  const dateText = date ? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}` : '';
  const checked = new Set(record?.checkedIds ?? []);
  return { ...state, title, dateText,
    resultText: record?.result === 'selfCompleted' ? '自评完成' : '练习中',
    criteria: record?.criteriaSnapshot.map(item => ({ ...item, checked: checked.has(item.id) })) ?? [],
    errorText: state.error === 'NOT_FOUND' ? '记录不存在或已删除' : state.error ? '操作未完成，请重试' : '' };
}

Page({
  controller: null as Controller | null,
  epoch: 0,
  recordId: '',
  pendingDeletion: false,
  data: { view: detailView({ phase: 'loading', record: null, playbackUrl: '', playbackError: false,
    error: null, busy: false }) },
  onLoad(query: Record<string, string | undefined>) {
    this.recordId = query.id ?? '';
    this.pendingDeletion = false;
  },
  async onShow() {
    const epoch = ++this.epoch;
    this.controller = createRecordDetailController(api, state => {
      if (epoch === this.epoch) {
        if (state.phase === 'deleting') this.pendingDeletion = true;
        if (state.phase === 'deleted') this.pendingDeletion = false;
        this.setData({ view: detailView(state) });
      }
    });
    if (this.pendingDeletion) await this.controller.resumeDeletion(this.recordId);
    else await this.controller.load(this.recordId);
  },
  onHide() { ++this.epoch; this.controller = null; },
  onUnload() { ++this.epoch; this.controller = null; },
  retryLoad() {
    if (this.pendingDeletion) void this.controller?.resumeDeletion(this.recordId);
    else void this.controller?.load(this.recordId);
  },
  videoError() { void this.controller?.videoError(); },
  retryPlayback() { void this.controller?.retryPlayback(); },
  confirmDelete() {
    if (this.data.view.busy) return;
    wx.showModal({ title: '删除练习记录', content: '删除这条记录和视频？已完成进度会保留。',
      confirmText: '删除', confirmColor: '#b34040', success: result => {
        if (result.confirm) void this.controller?.remove();
      } });
  },
  retryDelete() { void this.controller?.remove(); },
  goBack() { wx.navigateBack(); },
});
