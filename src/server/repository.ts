export interface Transaction {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, value: T): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}

export interface Repository {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  listOwned<T>(collection: string, ownerId: string,
    options: { lessonId?: string; state?: string; before?: { createdAt: number; id: string }; limit: number }): Promise<T[]>;
  countOwnedActive(ownerId: string): Promise<number>;
  listCleanupCandidates(now: number, limit: number):
    Promise<Array<{ collection: 'uploads' | 'practices'; id: string }>>;
}

export interface FileStore {
  inspect(fileId: string): Promise<{ bytes: number; video: boolean }>;
  playback(fileId: string): Promise<{ url: string; expiresAt: number }>;
  remove(fileId: string): Promise<void>;
}

export interface ServiceDeps {
  repository: Repository;
  files: FileStore;
  now: () => number;
  randomId: () => string;
  fileIdPrefix: string;
}

type Document = {
  get(): Promise<{ data: unknown }>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
  remove(): Promise<unknown>;
};
type Query = {
  where(condition: unknown): Query;
  orderBy(field: string, direction: 'asc' | 'desc'): Query;
  skip(offset: number): Query;
  limit(count: number): Query;
  get(): Promise<{ data: unknown[] }>;
  count(): Promise<{ total: number }>;
};
type Collection = Query & { doc(id: string): Document };
type AdapterDatabase = {
  runTransaction<T>(run: (tx: { collection(name: string): Collection }) => Promise<T>): Promise<T>;
  collection(name: string): Collection;
  command?: { lt(value: string | number): unknown; lte(value: number): unknown;
    or(conditions: Record<string, unknown>[]): unknown; and(conditions: unknown[]): unknown };
};

function missingDocument(error: unknown, id: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === `document.get:fail document with _id ${id} does not exist`;
}

export function createRepository(db: ReturnType<typeof import('wx-server-sdk').database>): Repository {
  const sdk = db as unknown as AdapterDatabase;
  return {
    transaction: run => sdk.runTransaction(async sdkTx => run({
      get: async <T>(collection: string, id: string): Promise<T | null> => {
        try {
          const result = await sdkTx.collection(collection).doc(id).get();
          return (result.data ?? null) as T | null;
        } catch (error) {
          if (missingDocument(error, id)) return null;
          throw error;
        }
      },
      set: async <T>(collection: string, id: string, value: T) => {
        await sdkTx.collection(collection).doc(id).set({ data: value as Record<string, unknown> });
      },
      remove: async (collection: string, id: string) => {
        await sdkTx.collection(collection).doc(id).remove();
      },
    })),
    listOwned: async <T>(collection: string, ownerId: string, options: { lessonId?: string; state?: string; before?: { createdAt: number; id: string }; limit: number }): Promise<T[]> => {
      const base: Record<string, unknown> = { ownerId };
      if (options.lessonId) base.lessonId = options.lessonId;
      if (options.state) base.state = options.state;
      let condition: unknown = base;
      if (options.before) {
        if (!sdk.command) throw new Error('Database cursor commands unavailable');
        condition = sdk.command.and([base, sdk.command.or([
          { createdAt: sdk.command.lt(options.before.createdAt) },
          { createdAt: options.before.createdAt, _id: sdk.command.lt(options.before.id) },
        ])]);
      }
      const result = await sdk.collection(collection).where(condition).orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc').limit(options.limit).get();
      return result.data as T[];
    },
    countOwnedActive: async ownerId => {
      const result = await sdk.collection('practices').where({ ownerId, state: 'active' }).count();
      return result.total;
    },
    listCleanupCandidates: async (now, limit) => {
      if (!sdk.command) throw new Error('Database cleanup commands unavailable');
      const sources = [
        { collection: 'uploads' as const, state: 'issued', timeField: 'expiresAt' },
        { collection: 'uploads' as const, state: 'cleaning', timeField: 'expiresAt' },
        { collection: 'practices' as const, state: 'deleting', timeField: 'deletionRequestedAt' },
      ].map(source => ({ ...source, offset: 0, exhausted: false }));
      const candidates: Array<{ collection: 'uploads' | 'practices'; id: string }> = [];
      while (candidates.length < limit && sources.some(source => !source.exhausted)) {
        for (const source of sources) {
          if (source.exhausted || candidates.length >= limit) continue;
          const pageSize = Math.min(20, limit - candidates.length);
          const page = await sdk.collection(source.collection).where({ state: source.state,
            [source.timeField]: sdk.command.lte(now) })
            .orderBy(source.timeField, 'asc').orderBy('_id', 'asc')
            .skip(source.offset).limit(pageSize).get();
          candidates.push(...page.data.map((doc: any) => ({ collection: source.collection, id: doc._id as string })));
          source.offset += page.data.length;
          source.exhausted = page.data.length < pageSize;
        }
      }
      return candidates;
    },
  };
}
