import type { LearningApi, PracticeRecord } from '../../domain/types';

export type RecordsState = {
  phase: 'loading' | 'ready' | 'empty' | 'error';
  lessonId?: string;
  items: PracticeRecord[];
  nextCursor: string | null;
  totalActive: number | null;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
};

type RecordsApi = Pick<LearningApi, 'listRecords' | 'deleteRecord'>;
const errorCode = (error: unknown) => (error as { code?: string })?.code ?? 'NETWORK_ERROR';

export function createRecordsController(api: RecordsApi, onChange?: (state: RecordsState) => void) {
  let generation = 0;
  let state: RecordsState = { phase: 'loading', items: [], nextCursor: null, totalActive: null,
    error: null, loadingMore: false, moreError: null };
  const publish = (change: Partial<RecordsState>) => {
    state = { ...state, ...change };
    onChange?.({ ...state, items: [...state.items] });
  };

  async function load(lessonId?: string) {
    const request = ++generation;
    publish({ phase: 'loading', lessonId, items: [], nextCursor: null, error: null,
      loadingMore: false, moreError: null });
    try {
      const page = await api.listRecords({ lessonId, limit: 20 });
      if (request !== generation) return;
      publish({ phase: page.items.length ? 'ready' : 'empty', items: page.items,
        nextCursor: page.nextCursor, totalActive: page.totalActive, error: null });
    } catch (error) {
      if (request === generation) publish({ phase: 'error', error: errorCode(error) });
    }
  }

  async function loadMore() {
    if (state.phase !== 'ready' || !state.nextCursor || state.loadingMore) return;
    const request = generation;
    const nextCursor = state.nextCursor;
    const lessonId = state.lessonId;
    publish({ loadingMore: true, moreError: null });
    try {
      const page = await api.listRecords({ lessonId, cursor: nextCursor, limit: 20 });
      if (request !== generation) return;
      const seen = new Set(state.items.map(item => item.id));
      publish({ items: [...state.items, ...page.items.filter(item => !seen.has(item.id))],
        nextCursor: page.nextCursor, totalActive: page.totalActive, loadingMore: false });
    } catch (error) {
      if (request === generation) publish({ loadingMore: false, moreError: errorCode(error) });
    }
  }

  async function remove(id: string) {
    const result = await api.deleteRecord(id);
    const hadItem = state.items.some(item => item.id === id);
    if (hadItem) {
      const items = state.items.filter(item => item.id !== id);
      publish({ items, phase: items.length ? 'ready' : 'empty',
        totalActive: state.totalActive === null ? null : Math.max(0, state.totalActive - 1) });
    }
    return result;
  }

  return { getState: () => ({ ...state, items: [...state.items] }), load, loadMore, remove };
}

export type RecordDetailState = {
  phase: 'loading' | 'ready' | 'error' | 'deleting' | 'deleted';
  record: PracticeRecord | null;
  playbackUrl: string;
  playbackError: boolean;
  error: string | null;
  busy: boolean;
};

type DetailApi = Pick<LearningApi, 'getRecord' | 'getPlayback' | 'deleteRecord'>;

export function createRecordDetailController(api: DetailApi, onChange?: (state: RecordDetailState) => void) {
  let generation = 0;
  let recordId = '';
  let autoRefreshed = false;
  let state: RecordDetailState = { phase: 'loading', record: null, playbackUrl: '',
    playbackError: false, error: null, busy: false };
  const publish = (change: Partial<RecordDetailState>) => {
    state = { ...state, ...change };
    onChange?.({ ...state });
  };
  async function playback(request: number) {
    try {
      const result = await api.getPlayback(recordId);
      if (request === generation) publish({ playbackUrl: result.url, playbackError: false, error: null });
    } catch (error) {
      if (request === generation) publish({ playbackUrl: '', playbackError: true, error: errorCode(error) });
    }
  }
  async function load(id: string) {
    const request = ++generation;
    recordId = id;
    autoRefreshed = false;
    publish({ phase: 'loading', record: null, playbackUrl: '', playbackError: false, error: null });
    try {
      const record = await api.getRecord(id);
      if (request !== generation) return;
      publish({ phase: 'ready', record });
      await playback(request);
    } catch (error) {
      if (request === generation) publish({ phase: 'error', error: errorCode(error) });
    }
  }
  async function videoError() {
    if (state.phase !== 'ready' || !state.playbackUrl) return;
    if (autoRefreshed) { publish({ playbackUrl: '', playbackError: true }); return; }
    autoRefreshed = true;
    publish({ playbackUrl: '' });
    await playback(generation);
  }
  async function retryPlayback() {
    if (state.phase !== 'ready' || !recordId) return;
    autoRefreshed = false;
    publish({ playbackUrl: '', playbackError: false, error: null });
    await playback(generation);
  }
  async function remove() {
    if (!recordId || state.busy) return null;
    publish({ busy: true, error: null });
    try {
      const result = await api.deleteRecord(recordId);
      publish({ phase: result.state, busy: false, playbackUrl: '' });
      return result;
    } catch (error) {
      publish({ busy: false, error: errorCode(error) });
      return null;
    }
  }
  async function resumeDeletion(id: string) {
    const request = ++generation;
    recordId = id;
    publish({ phase: 'loading', record: null, playbackUrl: '', playbackError: false, error: null, busy: true });
    try {
      const result = await api.deleteRecord(id);
      if (request === generation) publish({ phase: result.state, busy: false });
      return result;
    } catch (error) {
      if (request === generation) publish({ phase: 'error', busy: false, error: errorCode(error) });
      return null;
    }
  }
  return { getState: () => ({ ...state }), load, videoError, retryPlayback, remove, resumeDeletion };
}
