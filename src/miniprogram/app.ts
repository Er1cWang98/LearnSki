import { createLearningSession } from './presenters/learning';
import { createApi } from './services/cloud';

declare const __CLOUD_ENV_ID__: string;

App({
  globalData: {
    learning: createLearningSession(createApi(__CLOUD_ENV_ID__)),
  },
  onLaunch() {
    if (__CLOUD_ENV_ID__) wx.cloud.init({ env: __CLOUD_ENV_ID__ });
  },
});
