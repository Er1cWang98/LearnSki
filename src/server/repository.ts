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
      const [uploads, practices] = await Promise.all([
        sdk.collection('uploads').where({ state: 'issued', expiresAt: sdk.command.lte(now) }).limit(limit).get(),
        sdk.collection('practices').where({ state: 'deleting' }).limit(limit).get(),
      ]);
      return [
        ...uploads.data.map((doc: any) => ({ collection: 'uploads' as const, id: doc._id as string })),
        ...practices.data.map((doc: any) => ({ collection: 'practices' as const, id: doc._id as string })),
      ].slice(0, limit);
    },
  };
}
