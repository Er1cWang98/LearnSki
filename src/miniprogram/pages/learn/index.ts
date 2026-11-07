import { toRouteView } from '../../presenters/learning';
import type { LearningSession } from '../../presenters/learning';

type LearningApp = { globalData: { learning: LearningSession } };

Page({
  data: { route: toRouteView(null, false) },
  async onShow() {
    const session = getApp<LearningApp>().globalData.learning;
    this.setData({ route: toRouteView(session.state.progress, session.state.stale) });
    const state = await session.refresh();
    this.setData({ route: toRouteView(state.progress, state.stale) });
  },
  openLesson(event: WechatMiniprogram.BaseEvent) {
    const id = event.currentTarget.dataset.id as string;
    if (id) wx.navigateTo({ url: `/pages/lesson/index?id=${encodeURIComponent(id)}` });
  },
  continueLearning() {
    const session = getApp<LearningApp>().globalData.learning;
    const route = toRouteView(session.state.progress, session.state.stale);
    wx.navigateTo({ url: `/pages/lesson/index?id=${route.continueLessonId}` });
  },
});
