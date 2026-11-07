import { createHash } from 'node:crypto';
import { getLesson } from '../catalog/intro';
import { getProgress as calculateProgress } from '../domain/progress';
import { validateCommit } from '../domain/validation';
import type { CommitInput, Completion, LearningApi, PracticeRecord, UploadTicket } from '../domain/types';
import type { ServiceDeps, Transaction } from './repository';

export type CheckInApi = Pick<LearningApi, 'getProgress' | 'createUpload' | 'commit'>;

type StoredCompletion = Completion & { ownerId: string; createdAt: number };
type UploadSession = UploadTicket & {
  ownerId: string; lessonId: string; lessonVersion: number; state: 'issued' | 'consumed';
  createdAt: number; recordId?: string; inputDigest?: string;
};
type StoredPractice = PracticeRecord & { ownerId: string; videoFileId: string; state: 'active' | 'deleting'; deletionRequestedAt?: number };

const day = 24 * 60 * 60 * 1000;
const maxBytes = 100 * 1024 * 1024;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const error = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }); };
const completionId = (ownerId: string, lessonId: string) => hash(`${ownerId}:${lessonId}`);

function publicRecord(doc: StoredPractice): PracticeRecord {
  const { id, lessonId, lessonVersion, criteriaSnapshot, checkedIds, note, result, createdAt } = doc;
  return { id, lessonId, lessonVersion, criteriaSnapshot, checkedIds, note, result, createdAt };
}

export function createService(deps: ServiceDeps): { forUser(ownerId: string): CheckInApi } {
  return {
    forUser(ownerId) {
      if (typeof ownerId !== 'string' || !ownerId.trim()) error('UNAUTHENTICATED', '请先登录');

      async function progress() {
        const completions = await deps.repository.listOwned<StoredCompletion>('completions', ownerId, { limit: 100 });
        return { scope: hash(ownerId), progress: calculateProgress(completions) };
      }

      async function readPrerequisites(tx: Transaction, lessonId: string): Promise<StoredCompletion[]> {
        const lesson = getLesson(lessonId);
        const completions = await Promise.all(lesson.prerequisiteIds.map(id =>
          tx.get<StoredCompletion>('completions', completionId(ownerId, id))));
        if (completions.some((item, index) => !item || item.ownerId !== ownerId ||
          item.lessonId !== lesson.prerequisiteIds[index])) error('LESSON_LOCKED', '课程尚未解锁');
        return completions as StoredCompletion[];
      }

      async function loadSession(tx: Transaction, input: CommitInput): Promise<UploadSession> {
        if (!input || typeof input.sessionId !== 'string' || !input.sessionId) error('INVALID_INPUT', '打卡内容无效');
        const session = await tx.get<UploadSession>('uploads', input.sessionId);
        if (!session) return error('NOT_FOUND', '上传会话不存在');
        if (session.ownerId !== ownerId) return error('NOT_FOUND', '上传会话不存在');
        return session;
      }

      async function replay(tx: Transaction, session: UploadSession, digest: string): Promise<StoredPractice> {
        if (session.inputDigest !== digest) error('CONFLICT', '上传会话已用于其他打卡');
        const record = await tx.get<StoredPractice>('practices', session.recordId ?? session.id);
        if (!record) return error('RECORD_DELETED', '这条记录已删除');
        if (record.ownerId !== ownerId) return error('NOT_FOUND', '练习记录不存在');
        if (record.state !== 'active') return error('RECORD_DELETED', '这条记录已删除');
        return record;
      }

      return {
        getProgress: progress,
        async createUpload(input) {
          if (!input || typeof input.lessonId !== 'string' || !input.lessonId ||
            typeof input.lessonVersion !== 'number') error('INVALID_INPUT', '课程信息无效');
          const lesson = getLesson(input.lessonId);
          if (input.lessonVersion !== lesson.version) error('VERSION_CHANGED', '课程内容已更新');
          const id = deps.randomId();
          if (typeof id !== 'string' || !id) throw new Error('Invalid random session ID');
          const createdAt = deps.now();
          const cloudPath = `practice/${ownerId}/${id}/video`;
          const ticket: UploadTicket = { id, cloudPath,
            expectedFileId: deps.fileIdPrefix.replace(/\/$/, '') + '/' + cloudPath,
            expiresAt: createdAt + day };
          await deps.repository.transaction(async tx => {
            await readPrerequisites(tx, lesson.id);
            if (await tx.get('uploads', id)) error('CONFLICT', '上传会话冲突');
            await tx.set<UploadSession>('uploads', id, { ...ticket, ownerId, lessonId: lesson.id,
              lessonVersion: lesson.version, state: 'issued', createdAt });
          });
          return ticket;
        },
        async commit(input) {
          if (!input || typeof input !== 'object') error('INVALID_INPUT', '打卡内容无效');
          const digest = hash(JSON.stringify([input.sessionId, input.fileId, input.lessonVersion,
            input.checkedIds, input.note, input.result]));
          const initial = await deps.repository.transaction(async tx => {
            const session = await loadSession(tx, input);
            if (session.state === 'consumed') return { record: await replay(tx, session, digest) };
            if (session.state !== 'issued') error('CONFLICT', '上传会话不可提交');
            const lesson = getLesson(session.lessonId);
            validateCommit(lesson, input);
            if (input.fileId !== session.expectedFileId) error('INVALID_INPUT', '视频与上传会话不匹配');
            if (deps.now() >= session.expiresAt) error('UPLOAD_EXPIRED', '上传会话已过期');
            return { record: null };
          });
          if (initial.record) return { record: publicRecord(initial.record), progress: (await progress()).progress };
          const media = await deps.files.inspect(input.fileId);
          if (!media || !media.video || !Number.isFinite(media.bytes) || media.bytes < 1 || media.bytes > maxBytes)
            error('VIDEO_INVALID', '视频无效或超过大小限制');
          const record = await deps.repository.transaction(async tx => {
            const session = await loadSession(tx, input);
            if (session.state === 'consumed') return replay(tx, session, digest);
            if (session.state !== 'issued') error('CONFLICT', '上传会话不可提交');
            const lesson = getLesson(session.lessonId);
            const [, existing, previous] = await Promise.all([
              readPrerequisites(tx, lesson.id),
              tx.get<StoredCompletion>('completions', completionId(ownerId, lesson.id)),
              tx.get<StoredPractice>('practices', session.id),
            ]);
            if (previous) error('CONFLICT', '练习记录已存在');
            validateCommit(lesson, input);
            if (input.fileId !== session.expectedFileId) error('INVALID_INPUT', '视频与上传会话不匹配');
            if (deps.now() >= session.expiresAt) error('UPLOAD_EXPIRED', '上传会话已过期');
            const createdAt = deps.now();
            const stored: StoredPractice = { id: session.id, ownerId, lessonId: lesson.id,
              lessonVersion: lesson.version, criteriaSnapshot: lesson.criteria.map(item => ({ ...item })),
              checkedIds: [...new Set(input.checkedIds)], note: input.note, result: input.result,
              videoFileId: session.expectedFileId, state: 'active', createdAt };
            await tx.set('practices', stored.id, stored);
            if (input.result === 'selfCompleted' && !existing) {
              await tx.set<StoredCompletion>('completions', completionId(ownerId, lesson.id), {
                ownerId, lessonId: lesson.id, lessonVersion: lesson.version,
                firstCompletedAt: createdAt, createdAt, sourceRecordId: stored.id,
              });
            }
            await tx.set<UploadSession>('uploads', session.id, {
              ...session, state: 'consumed', recordId: stored.id, inputDigest: digest,
            });
            return stored;
          });
          return { record: publicRecord(record), progress: (await progress()).progress };
        },
      };
    },
  };
}
