import { getLesson } from '../../../catalog/intro';
import type { Lesson, Outcome } from '../../../domain/types';
import { toLessonView } from '../../presenters/learning';
import type { LearningSession } from '../../presenters/learning';
import { createPracticeController } from '../../presenters/practice';
import type { PracticeState } from '../../presenters/practice';
import { createApi } from '../../services/cloud';
import { createDraftStore } from '../../services/drafts';
import { createMedia } from '../../services/media';

declare const __CLOUD_ENV_ID__: string;

const api = createApi(__CLOUD_ENV_ID__);
const drafts = createDraftStore(wx);
const media = createMedia(wx);
type Controller = ReturnType<typeof createPracticeController>;
type LearningApp = { globalData: { learning: LearningSession } };

const messages: Record<string, string> = {
  CLOUD_UNAVAILABLE: '云服务暂不可用，草稿已保存在本次使用中',
  UNAUTHENTICATED: '请重新连接后再试',
  NETWORK_ERROR: '网络未确认提交结果，请重试',
  MEDIA_ACCESS_DENIED: '无法读取视频，请检查相册或相机权限',
  VIDEO_INVALID: '视频需在 3 分钟、100 MB 以内',
  VIDEO_REQUIRED: '请先上传视频',
  CHECKLIST_INCOMPLETE: '完成自评需勾选全部自查项',
  UPLOAD_EXPIRED: '上传已过期，请重新上传视频',
  VERSION_CHANGED: '课程内容已更新，请重新打开课程确认自查项',
  RUBRIC_RECONFIRM: '课程内容已更新，请重新确认自查项',
  LESSON_LOCKED: '请先完成前置课程',
  DRAFT_SAVE_FAILED: '本机草稿保存失败，请检查存储空间后重试',
  DRAFT_LOAD_FAILED: '本机草稿读取失败，请重新打开页面',
};

function display(state: PracticeState, lesson: Lesson) {
  const busy = state.phase === 'selecting' || state.phase === 'uploading' || state.phase === 'submitting';
  const canSubmit = state.phase === 'editing' && !state.versionBlocked && !state.needsReconfirmation &&
    (state.uploaded || !!state.frozen) && !busy;
  return {
    state,
    criteria: lesson.criteria.map(item => ({ ...item, checked: state.checkedIds.includes(item.id) })),
    noteLength: [...state.note].length,
    busy,
    canSave: canSubmit,
    canComplete: canSubmit && lesson.criteria.every(item => state.checkedIds.includes(item.id)),
    errorText: state.error ? messages[state.error] ?? '操作未完成，请重试' : '',
    nextTitle: state.result === 'selfCompleted' && state.progress?.nextLessonId
      ? getLesson(state.progress.nextLessonId).title : '',
  };
}

Page({
  controller: null as Controller | null,
  cleanup: Promise.resolve() as Promise<void>,
  epoch: 0,
  data: {
    lesson: null as Lesson | null,
    invalid: false,
    unavailable: false,
    loading: true,
    view: null as ReturnType<typeof display> | null,
  },
  onLoad(query: Record<string, string | undefined>) {
    try { this.setData({ lesson: getLesson(query.id ?? '') }); }
    catch { this.setData({ invalid: true }); }
  },
  async onShow() {
    const lesson = this.data.lesson;
    if (!lesson) return;
    const epoch = ++this.epoch;
    await this.cleanup;
    if (epoch !== this.epoch) return;
    await this.controller?.dispose();
    this.controller = null;
    this.setData({ loading: true, unavailable: false, view: null });
    const learning = getApp<LearningApp>().globalData.learning;
    const session = await learning.refresh();
    if (epoch !== this.epoch) return;
    const allowed = toLessonView(lesson, session.progress).showFullContent;
    if (!allowed) { this.setData({ unavailable: true, loading: false }); return; }
    this.setData({ unavailable: false });
    const controller = createPracticeController({ api, media, drafts, lesson, scope: session.scope,
      onCommitted: progress => { learning.applyConfirmed(session.scope, progress); },
      onChange: state => {
        if (epoch === this.epoch) this.setData({ view: display(state, lesson) });
      },
    });
    this.controller = controller;
    await controller.ready;
    if (epoch === this.epoch) this.setData({ loading: false });
  },
  onHide() {
    ++this.epoch;
    this.cleanup = this.controller?.dispose() ?? Promise.resolve();
    this.controller = null;
  },
  onUnload() {
    ++this.epoch;
    this.cleanup = this.controller?.dispose() ?? Promise.resolve();
    this.controller = null;
  },
  toggleCriterion(event: WechatMiniprogram.BaseEvent) {
    const controller = this.controller;
    if (!controller) return;
    const id = event.currentTarget.dataset.id as string;
    const current = controller.getState().checkedIds;
    controller.setChecked(current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  },
  editNote(event: { detail: { value: string } }) { this.controller?.setNote(event.detail.value); },
  chooseAlbum() { void this.controller?.choose('album'); },
  chooseCamera() { void this.controller?.choose('camera'); },
  cancelUpload() { this.controller?.cancelUpload(); },
  retryUpload() { void this.controller?.retryUpload(); },
  savePractice() { void this.controller?.submit('practicing'); },
  completePractice() { void this.controller?.submit('selfCompleted'); },
  retrySubmit() { void this.controller?.submit('practicing'); },
  beginEdit() { this.controller?.beginEdit(); },
  confirmRubric() { this.controller?.confirmRubric(); },
  openNext() {
    const nextId = this.controller?.getState().progress?.nextLessonId;
    if (nextId) wx.navigateTo({ url: `/pages/lesson/index?id=${encodeURIComponent(nextId)}` });
  },
  backToLesson() { wx.navigateBack(); },
});
