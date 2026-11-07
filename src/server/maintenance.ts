import { createHash } from 'node:crypto';
import type { ServiceDeps } from './repository';
import { finishDeletionTransition } from './service';

type Upload = { state: 'issued' | 'consumed' | 'cleaning' | 'expired'; expiresAt: number; expectedFileId: string };
type Practice = { state: 'active' | 'deleting'; ownerId: string };
type Counts = { removed: number; failed: number; skipped: number };
const safeErrorCodes = new Set(['CLOUD_UNAVAILABLE', 'NETWORK_ERROR', 'FILE_REMOVE_FAILED']);

function logFailure(collection: string, id: string, cause: unknown): void {
  const rawCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  const code = typeof rawCode === 'string' && safeErrorCodes.has(rawCode)
    ? rawCode : 'MAINTENANCE_FAILED';
  console.error(JSON.stringify({ event: 'maintenance_failure', collection,
    idHash: createHash('sha256').update(id).digest('hex').slice(0, 16), code }));
}

async function cleanUpload(deps: ServiceDeps, id: string, now: number): Promise<'removed' | 'skipped'> {
  const fileId = await deps.repository.transaction(async tx => {
    const upload = await tx.get<Upload>('uploads', id);
    if (!upload || upload.expiresAt > now || (upload.state !== 'issued' && upload.state !== 'cleaning')) return null;
    if (upload.state === 'issued') await tx.set('uploads', id, { ...upload, state: 'cleaning' });
    return upload.expectedFileId;
  });
  if (!fileId) return 'skipped';
  await deps.files.remove(fileId);
  return deps.repository.transaction(async tx => {
    const upload = await tx.get<Upload>('uploads', id);
    if (upload?.state !== 'cleaning') return 'skipped';
    await tx.set('uploads', id, { ...upload, state: 'expired' });
    return 'removed';
  });
}

async function cleanPractice(deps: ServiceDeps, id: string): Promise<'removed' | 'failed' | 'skipped'> {
  const ownerId = await deps.repository.transaction(async tx => {
    const practice = await tx.get<Practice>('practices', id);
    return practice?.state === 'deleting' ? practice.ownerId : null;
  });
  if (!ownerId) return 'skipped';
  const result = await finishDeletionTransition(deps, ownerId, id);
  return result.state === 'deleting' ? 'failed' : result.removed ? 'removed' : 'skipped';
}

export async function runMaintenance(deps: ServiceDeps, limit: number): Promise<Counts> {
  const count = Number.isFinite(limit) ? Math.max(0, Math.min(100, Math.floor(limit))) : 0;
  const result: Counts = { removed: 0, failed: 0, skipped: 0 };
  if (!count) return result;
  const now = deps.now();
  const candidates = await deps.repository.listCleanupCandidates(now, count);
  for (let offset = 0; offset < candidates.length && offset < count; offset += 20) {
    for (const candidate of candidates.slice(offset, offset + 20)) {
      try {
        const outcome = candidate.collection === 'uploads'
          ? await cleanUpload(deps, candidate.id, now)
          : await cleanPractice(deps, candidate.id);
        result[outcome]++;
        if (outcome === 'failed') logFailure(candidate.collection, candidate.id, { code: 'FILE_REMOVE_FAILED' });
      } catch (cause) {
        result.failed++;
        logFailure(candidate.collection, candidate.id, cause);
      }
    }
  }
  return result;
}
