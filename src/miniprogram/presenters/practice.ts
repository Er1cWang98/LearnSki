import type { CommitInput, LearningApi, Lesson, Outcome, Progress, UploadTicket } from '../../domain/types';
import { validateLocalVideo } from '../../domain/validation';
import type { DraftStore, PracticeDraft } from '../services/drafts';
import type { LocalVideo, UploadHandle } from '../services/media';

type PracticeApi = Pick<LearningApi, 'createUpload' | 'commit'>;
type PracticeMedia = {
  selectVideo(source: 'album' | 'camera'): Promise<LocalVideo>;
  startUpload(ticket: UploadTicket, video: LocalVideo, onProgress: (value: number) => void): UploadHandle;
};
export type PracticeState = {
  phase: 'editing' | 'selecting' | 'uploading' | 'submitting' | 'success';
  checkedIds: string[];
  note: string;
  video: LocalVideo | null;
  percent: number;
  error: string | null;
  recordId: string | null;
  result: Outcome | null;
  progress: Progress | null;
  versionBlocked: boolean;
  needsReconfirmation: boolean;
  frozen: boolean;
  uploaded: boolean;
};

export function createPracticeController(options: {
  api: PracticeApi; media: PracticeMedia; drafts: DraftStore; lesson: Lesson;
  scope: string | null; onChange: (state: PracticeState) => void;
  onCommitted?: (progress: Progress) => void;
}) {
  const { api, media, drafts, lesson, scope, onChange, onCommitted } = options;
  let state: PracticeState = { phase: 'editing', checkedIds: [], note: '', video: null, percent: 0,
    error: null, recordId: null, result: null, progress: null, versionBlocked: false,
    needsReconfirmation: false, frozen: false, uploaded: false };
  let ticket: UploadTicket | null = null;
  let fileId: string | null = null;
  let snapshot: CommitInput | null = null;
  let handle: UploadHandle | null = null;
  let generation = 0;
  let disposed = false;
  let initialized = false;
  let pendingSubmit: Promise<void> | null = null;
  const active = (id: number) => !disposed && id === generation;
  const emit = () => onChange({ ...state, checkedIds: [...state.checkedIds] });
  const change = (patch: Partial<PracticeState>) => { state = { ...state, ...patch }; emit(); };
  const draft = (): PracticeDraft => ({ lessonVersion: lesson.version, checkedIds: [...state.checkedIds], note: state.note,
    video: state.video, ticket, fileId, snapshot, versionBlocked: state.versionBlocked,
    needsReconfirmation: state.needsReconfirmation });
  const save = async (): Promise<boolean> => {
    try {
      await drafts.save(scope, lesson.id, draft());
      return true;
    } catch { return false; }
  };
  const saveInBackground = () => {
    void save().then(saved => {
      if (!saved && !disposed && state.phase === 'editing') change({ error: 'DRAFT_SAVE_FAILED' });
    });
  };
  const code = (error: unknown) => (error as { code?: string })?.code ?? 'NETWORK_ERROR';
  const ready = (async () => {
    let loaded: PracticeDraft | null;
    try { loaded = await drafts.load(scope, lesson.id); }
    catch {
      if (!disposed) change({ error: 'DRAFT_LOAD_FAILED' });
      return;
    }
    if (disposed) return;
    initialized = true;
    if (!loaded) return;
    const versionChanged = loaded.lessonVersion !== lesson.version;
    ticket = versionChanged ? null : loaded.ticket ?? null;
    fileId = versionChanged ? null : loaded.fileId ?? null;
    snapshot = versionChanged ? null : loaded.snapshot ?? null;
    change({ checkedIds: versionChanged ? [] : loaded.checkedIds.filter(id => lesson.criteria.some(item => item.id === id)),
      note: loaded.note, video: loaded.video, versionBlocked: versionChanged ? false : !!loaded.versionBlocked,
      needsReconfirmation: versionChanged || !!loaded.needsReconfirmation,
      error: versionChanged ? 'RUBRIC_RECONFIRM' : null, frozen: !!snapshot, uploaded: !!fileId });
    if (versionChanged && !(await save()) && !disposed) change({ error: 'DRAFT_SAVE_FAILED' });
  })();
  emit();

  async function upload(video: LocalVideo, id: number) {
    try {
      if (!active(id)) return;
      validateLocalVideo(video);
      const created = await api.createUpload({ lessonId: lesson.id, lessonVersion: lesson.version });
      if (!active(id)) return;
      ticket = created;
      if (!(await save())) {
        if (active(id)) change({ phase: 'editing', error: 'DRAFT_SAVE_FAILED' });
        return;
      }
      if (!active(id)) return;
      const current = media.startUpload(created, video, percent => {
        if (active(id) && state.phase === 'uploading') change({ percent });
      });
      handle = current;
      const uploadedId = await current.promise;
      if (!active(id)) return;
      fileId = uploadedId;
      handle = null;
      change({ phase: 'editing', percent: 100, uploaded: true });
      if (!(await save()) && active(id)) change({ error: 'DRAFT_SAVE_FAILED' });
    } catch (error) {
      if (!active(id)) return;
      handle = null;
      const errorCode = code(error);
      change({ phase: 'editing', error: errorCode, versionBlocked: errorCode === 'VERSION_CHANGED' });
      if (!(await save()) && active(id)) change({ error: 'DRAFT_SAVE_FAILED' });
    }
  }

  async function choose(source: 'album' | 'camera') {
    await ready;
    if (disposed || !initialized || state.phase === 'submitting' || state.phase === 'success' || state.needsReconfirmation || state.versionBlocked) return;
    const id = ++generation;
    handle?.abort();
    handle = null;
    change({ phase: 'selecting', error: null });
    try {
      const video = await media.selectVideo(source);
      if (!active(id)) return;
      validateLocalVideo(video);
      ticket = null; fileId = null; snapshot = null;
      change({ video, phase: scope ? 'uploading' : 'editing', percent: 0, frozen: false, uploaded: false,
        error: scope ? null : 'CLOUD_UNAVAILABLE' });
      if (!(await save())) {
        if (active(id)) change({ phase: 'editing', error: 'DRAFT_SAVE_FAILED' });
        return;
      }
      if (scope && active(id)) await upload(video, id);
    } catch (error) {
      if (!active(id)) return;
      change({ phase: 'editing', error: code(error) === 'MEDIA_CANCELLED' ? null : code(error) });
    }
  }

  async function retryUpload() {
    await ready;
    if (disposed || !initialized || state.phase !== 'editing' || !state.video || state.versionBlocked || state.needsReconfirmation) return;
    if (!scope) { change({ error: 'CLOUD_UNAVAILABLE' }); return; }
    const id = ++generation;
    ticket = null; fileId = null; snapshot = null;
    change({ phase: 'uploading', error: null, percent: 0, frozen: false, uploaded: false });
    await upload(state.video, id);
  }

  function cancelUpload() {
    if (disposed || (state.phase !== 'selecting' && state.phase !== 'uploading')) return;
    ++generation;
    handle?.abort();
    handle = null;
    ticket = null; fileId = null; snapshot = null;
    change({ phase: 'editing', error: null, percent: 0, frozen: false, uploaded: false });
    saveInBackground();
  }

  function setChecked(ids: string[]) {
    if (disposed || !initialized || state.phase !== 'editing' || snapshot) return;
    const valid = new Set(lesson.criteria.map(item => item.id));
    change({ checkedIds: [...new Set(ids)].filter(id => valid.has(id)), error: null });
    saveInBackground();
  }

  function setNote(note: string) {
    if (disposed || !initialized || state.phase !== 'editing' || snapshot) return;
    change({ note: [...note].slice(0, 500).join(''), error: null });
    saveInBackground();
  }

  function beginEdit() {
    if (disposed || !initialized || state.phase !== 'editing' || !snapshot) return;
    ++generation;
    ticket = null; fileId = null; snapshot = null;
    change({ error: null, percent: 0, frozen: false, uploaded: false });
    saveInBackground();
  }

  function confirmRubric() {
    if (disposed || !initialized || state.versionBlocked || !state.needsReconfirmation || state.phase !== 'editing') return;
    change({ needsReconfirmation: false, error: null });
    saveInBackground();
  }

  function submit(result: Outcome): Promise<void> {
    if (pendingSubmit) return pendingSubmit;
    pendingSubmit = (async () => {
      await ready;
      if (disposed || !initialized || state.phase !== 'editing' || state.versionBlocked) return;
      if (state.needsReconfirmation) { change({ error: 'RUBRIC_RECONFIRM' }); return; }
      if (!scope) { change({ error: 'CLOUD_UNAVAILABLE' }); return; }
      if (!snapshot) {
        if (!fileId) { change({ error: 'VIDEO_REQUIRED' }); return; }
        if (result === 'selfCompleted' && lesson.criteria.some(item => !state.checkedIds.includes(item.id))) {
          change({ error: 'CHECKLIST_INCOMPLETE' }); return;
        }
        snapshot = { sessionId: ticket!.id, fileId, lessonVersion: lesson.version,
          checkedIds: [...state.checkedIds], note: state.note, result };
      }
      const id = generation;
      change({ phase: 'submitting', error: null, frozen: true });
      if (!(await save())) {
        if (active(id)) change({ phase: 'editing', error: 'DRAFT_SAVE_FAILED' });
        return;
      }
      if (!active(id)) return;
      try {
        const confirmed = await api.commit(snapshot);
        if (!active(id)) return;
        onCommitted?.(confirmed.progress);
        change({ phase: 'success', recordId: confirmed.record.id, result: confirmed.record.result,
          progress: confirmed.progress });
        try { await drafts.remove(scope, lesson.id); } catch { /* Server confirmation is authoritative. */ }
      } catch (error) {
        if (!active(id)) return;
        const errorCode = code(error);
        change({ phase: 'editing', error: errorCode, versionBlocked: errorCode === 'VERSION_CHANGED' });
        if (!(await save()) && active(id)) change({ error: 'DRAFT_SAVE_FAILED' });
      }
    })().finally(() => { pendingSubmit = null; });
    return pendingSubmit;
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    ++generation;
    handle?.abort();
    handle = null;
    await ready;
    if (initialized && state.phase !== 'success') await save();
  }

  return { ready, getState: () => ({ ...state, checkedIds: [...state.checkedIds] }), setChecked, setNote,
    choose, retryUpload, cancelUpload, submit, beginEdit, confirmRubric, dispose };
}
