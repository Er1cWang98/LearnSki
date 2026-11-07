import type { CommitInput, UploadTicket } from '../../domain/types';
import type { LocalVideo } from './media';

export type PracticeDraft = {
  lessonVersion: number;
  checkedIds: string[];
  note: string;
  video: LocalVideo | null;
  ticket: UploadTicket | null;
  fileId: string | null;
  snapshot: CommitInput | null;
  versionBlocked: boolean;
  needsReconfirmation?: boolean;
  videoExpired?: boolean;
};

export type DraftStore = {
  load(scope: string | null, lessonId: string): Promise<PracticeDraft | null>;
  save(scope: string | null, lessonId: string, draft: PracticeDraft): Promise<void> | void;
  remove(scope: string | null, lessonId: string): Promise<void> | void;
};

export function createDraftStore(wxApi: typeof wx): DraftStore {
  const memory = new Map<string, PracticeDraft>();
  const keyFor = (scope: string | null, lessonId: string) => `practice:${scope ?? 'memory'}:${lessonId}`;
  const hasLocalFile = (path: string) => new Promise<boolean>(resolve => {
    wxApi.getFileSystemManager().access({ path, success: () => resolve(true), fail: () => resolve(false) });
  });
  return {
    async load(scope, lessonId) {
      const key = keyFor(scope, lessonId);
      const draft = scope ? wxApi.getStorageSync(key) as PracticeDraft | undefined : memory.get(key);
      if (!draft || typeof draft !== 'object' || !Array.isArray(draft.checkedIds) || typeof draft.note !== 'string') return null;
      const restored = { ...draft, checkedIds: [...draft.checkedIds] };
      if (restored.video?.path && !(await hasLocalFile(restored.video.path))) {
        restored.video = null;
        restored.videoExpired = true;
      }
      return restored;
    },
    save(scope, lessonId, draft) {
      const key = keyFor(scope, lessonId);
      const copy = { ...draft, checkedIds: [...draft.checkedIds], snapshot: draft.snapshot && { ...draft.snapshot, checkedIds: [...draft.snapshot.checkedIds] } };
      if (scope) wxApi.setStorageSync(key, copy);
      else memory.set(key, copy);
    },
    remove(scope, lessonId) {
      const key = keyFor(scope, lessonId);
      if (scope) wxApi.removeStorageSync(key);
      else memory.delete(key);
    },
  };
}
