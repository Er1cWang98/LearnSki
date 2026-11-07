export type Outcome = 'practicing' | 'selfCompleted';

export type Criterion = { id: string; text: string };

export type Lesson = {
  id: string;
  stageId: string;
  order: number;
  optional: boolean;
  prerequisiteIds: string[];
  version: number;
  reviewStatus: 'draft' | 'reviewed';
  title: string;
  goal: string;
  steps: string[];
  keyPoints: string[];
  commonMistakes: string[];
  criteria: Criterion[];
  source: 'user-notes' | 'editorial-draft';
  media: null | { type: 'video' | 'gif'; src: string; poster?: string };
};

export type Completion = {
  lessonId: string;
  lessonVersion: number;
  firstCompletedAt: number;
  sourceRecordId: string | null;
};

export type Progress = {
  completedIds: string[];
  requiredDone: number;
  requiredTotal: number;
  nextLessonId: string | null;
  stageComplete: boolean;
};

export type PracticeRecord = {
  id: string;
  lessonId: string;
  lessonVersion: number;
  criteriaSnapshot: Criterion[];
  checkedIds: string[];
  note: string;
  result: Outcome;
  createdAt: number;
};

export type UploadTicket = {
  id: string;
  cloudPath: string;
  expectedFileId: string;
  expiresAt: number;
};

export type CommitInput = {
  sessionId: string;
  fileId: string;
  lessonVersion: number;
  checkedIds: string[];
  note: string;
  result: Outcome;
};

export type RecordPage = { items: PracticeRecord[]; nextCursor: string | null; totalActive: number };

export type LearningApi = {
  getProgress(): Promise<{ scope: string; progress: Progress }>;
  createUpload(input: { lessonId: string; lessonVersion: number }): Promise<UploadTicket>;
  commit(input: CommitInput): Promise<{ record: PracticeRecord; progress: Progress }>;
  listRecords(input: { lessonId?: string; cursor?: string; limit: number }): Promise<RecordPage>;
  getRecord(id: string): Promise<PracticeRecord>;
  getPlayback(id: string): Promise<{ url: string; expiresAt: number }>;
  deleteRecord(id: string): Promise<{ state: 'deleted' | 'deleting' }>;
};
