import { createHash, randomUUID } from 'node:crypto';
import { createService } from '../../src/server/service';
import type { FileStore, Repository, Transaction } from '../../src/server/repository';
import type { Completion, PracticeRecord } from '../../src/domain/types';
import { getLesson } from '../../src/catalog/intro';
import { createPracticeController } from '../../src/miniprogram/presenters/practice';
import type { PracticeDraft } from '../../src/miniprogram/services/drafts';

type Stored = { ownerId?: string; lessonId?: string; createdAt?: number; expiresAt?: number; state?: string; deletionRequestedAt?: number };

export class MemoryRepository implements Repository {
  private data = new Map<string, Map<string, unknown>>();
  private tail: Promise<void> = Promise.resolve();
  private failCommit = false;

  failNextCommit(): void { this.failCommit = true; }

  async transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      let wrote = false;
      const snapshot = new Map([...this.data].map(([name, docs]) =>
        [name, new Map([...docs].map(([id, doc]) => [id, structuredClone(doc)]))]));
      const collection = (name: string) => {
        let docs = snapshot.get(name);
        if (!docs) { docs = new Map(); snapshot.set(name, docs); }
        return docs;
      };
      const tx: Transaction = {
        get: async <U>(name: string, id: string) => structuredClone(collection(name).get(id) ?? null) as U | null,
        set: async <U>(name: string, id: string, value: U) => { wrote = true; collection(name).set(id, structuredClone(value)); },
        remove: async (name: string, id: string) => { wrote = true; collection(name).delete(id); },
      };
      const result = await run(tx);
      if (this.failCommit && wrote) { this.failCommit = false; throw new Error('injected commit failure'); }
      this.data = snapshot;
      return result;
    } finally { release(); }
  }

  async listOwned<T>(name: string, ownerId: string, options: { lessonId?: string; before?: { createdAt: number; id: string }; limit: number }): Promise<T[]> {
    return [...(this.data.get(name)?.entries() ?? [])]
      .filter(([, raw]) => {
        const doc = raw as Stored;
        return doc.ownerId === ownerId && (!options.lessonId || doc.lessonId === options.lessonId);
      })
      .sort(([aId, a], [bId, b]) => (b as Stored).createdAt! - (a as Stored).createdAt! || bId.localeCompare(aId))
      .filter(([id, raw]) => !options.before || (raw as Stored).createdAt! < options.before.createdAt ||
        ((raw as Stored).createdAt === options.before.createdAt && id < options.before.id))
      .slice(0, options.limit).map(([, raw]) => structuredClone(raw) as T);
  }

  async listCleanupCandidates(now: number, limit: number): Promise<Array<{ collection: 'uploads' | 'practices'; id: string }>> {
    const candidates: Array<{ collection: 'uploads' | 'practices'; id: string }> = [];
    for (const [name, docs] of this.data) {
      if (name !== 'uploads' && name !== 'practices') continue;
      for (const [id, raw] of docs) {
        const doc = raw as Stored;
        if ((name === 'uploads' && doc.state === 'issued' && (doc.expiresAt ?? Infinity) <= now) ||
          (name === 'practices' && doc.state === 'deleting')) candidates.push({ collection: name, id });
      }
    }
    return candidates.slice(0, limit);
  }
}

export class MemoryFiles implements FileStore {
  private stored = new Map<string, { bytes: number; video: boolean }>();
  inspectFailure: Error | null = null;
  removeFailure: Error | null = null;
  put(id: string, value: { bytes: number; video: boolean }): void { this.stored.set(id, value); }
  async inspect(id: string): Promise<{ bytes: number; video: boolean }> {
    if (this.inspectFailure) throw this.inspectFailure;
    const result = this.stored.get(id);
    if (!result) throw Object.assign(new Error('file missing'), { code: 'VIDEO_REQUIRED' });
    return result;
  }
  async playback(id: string): Promise<{ url: string; expiresAt: number }> {
    if (!this.stored.has(id)) throw new Error('file missing');
    return { url: `https://example.test/${id}`, expiresAt: 123456 };
  }
  async remove(id: string): Promise<void> {
    if (this.removeFailure) throw this.removeFailure;
    this.stored.delete(id);
  }
}

export function createHarness() {
  const repository = new MemoryRepository();
  const files = new MemoryFiles();
  let now = 1_000_000;
  const service = createService({ repository, files, now: () => now, randomId: randomUUID,
    fileIdPrefix: 'cloud://test-env.123456/' });
  return {
    apiA: service.forUser('user-a'), apiB: service.forUser('user-b'), repository, files,
    advanceTime: (ms: number) => { now += ms; },
    failNextCommit: () => repository.failNextCommit(),
    seedCompletions: async (ownerId: string, completions: Completion[]) => {
      await repository.transaction(async tx => {
        for (const completion of completions) await tx.set('completions', createHash('sha256').update(`${ownerId}:${completion.lessonId}`).digest('hex'),
          { ...completion, ownerId, createdAt: completion.firstCompletedAt });
      });
    },
  };
}

export async function completeFirstLesson(h: ReturnType<typeof createHarness>): Promise<PracticeRecord> {
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.files.put(ticket.expectedFileId, { bytes: 1024, video: true });
  return (await h.apiA.commit({ sessionId: ticket.id, fileId: ticket.expectedFileId,
    lessonVersion: 1, checkedIds: ['intro-01-name', 'intro-01-check'], note: '',
    result: 'selfCompleted' })).record;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function createPracticeHarness() {
  const server = createHarness();
  const lesson = getLesson('intro-01');
  const commitGate = deferred<void>();
  const commitStarted = deferred<void>();
  const stored = new Map<string, PracticeDraft>();
  const commits: string[] = [];
  const states: Array<ReturnType<ReturnType<typeof createPracticeController>['getState']>> = [];
  let phaseWaiters: Array<{ phase: string; resolve: () => void }> = [];
  const media = {
    selectVideo: async () => ({ path: 'wxfile://clip.mp4', bytes: 1024, duration: 10 }),
    startUpload: (ticket: { expectedFileId: string }, _video: unknown, onProgress: (value: number) => void) => {
      server.files.put(ticket.expectedFileId, { bytes: 1024, video: true });
      onProgress(100);
      return { promise: Promise.resolve(ticket.expectedFileId), abort() {} };
    },
  };
  const api = {
    createUpload: server.apiA.createUpload,
    commit: async (input: Parameters<typeof server.apiA.commit>[0]) => {
      commits.push(input.sessionId);
      commitStarted.resolve();
      await commitGate.promise;
      return server.apiA.commit(input);
    },
  };
  const drafts = {
    load: async (scope: string | null, lessonId: string) => stored.get(`${scope}:${lessonId}`) ?? null,
    save: async (scope: string | null, lessonId: string, draft: PracticeDraft) => { stored.set(`${scope}:${lessonId}`, structuredClone(draft)); },
    remove: async (scope: string | null, lessonId: string) => { stored.delete(`${scope}:${lessonId}`); },
  };
  const controller = createPracticeController({ api, media, drafts, lesson, scope: 'scope-a', onChange(state) {
    states.push(state);
    const matching = phaseWaiters.filter(waiter => waiter.phase === state.phase);
    phaseWaiters = phaseWaiters.filter(waiter => waiter.phase !== state.phase);
    matching.forEach(waiter => waiter.resolve());
  } });
  return { controller, server, drafts, stored, commits, states, media, api,
    state: () => controller.getState(),
    untilPhase: (phase: string) => states.some(state => state.phase === phase)
      ? Promise.resolve() : new Promise<void>(resolve => phaseWaiters.push({ phase, resolve })),
    resolveCommit: () => commitGate.resolve(),
    untilCommit: () => commitStarted.promise,
  };
}
