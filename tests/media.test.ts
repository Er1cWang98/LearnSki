import test from 'node:test';
import assert from 'node:assert/strict';
import { createMedia } from '../src/miniprogram/services/media';
import type { UploadTicket } from '../src/domain/types';

const ticket: UploadTicket = { id: 's1', cloudPath: 'practice/a/s1/video',
  expectedFileId: 'cloud://env.bucket/practice/a/s1/video', expiresAt: 1000 };
const video = { path: 'wxfile://sample.mp4', bytes: 1024, duration: 10 };

test('selection uses the requested source and validates the selected video', async () => {
  const calls: unknown[] = [];
  const media = createMedia({ chooseMedia(options: any) {
    calls.push({ ...options, success: undefined, fail: undefined });
    options.success({ tempFiles: [{ tempFilePath: video.path, size: video.bytes, duration: video.duration }] });
  } } as unknown as typeof wx);
  assert.deepEqual(await media.selectVideo('camera'), video);
  assert.deepEqual(calls[0], { count: 1, mediaType: ['video'], sourceType: ['camera'], maxDuration: 60,
    success: undefined, fail: undefined });
});

test('album import rejects overlong or oversized video', async () => {
  for (const file of [{ ...video, duration: 181 }, { ...video, bytes: 104857601 }]) {
    const media = createMedia({ chooseMedia(options: any) {
      options.success({ tempFiles: [{ tempFilePath: file.path, size: file.bytes, duration: file.duration }] });
    } } as unknown as typeof wx);
    await assert.rejects(media.selectVideo('album'), { code: 'VIDEO_INVALID' });
  }
});

test('cancelled selection and access failure remain distinct', async () => {
  for (const [message, code] of [['chooseMedia:fail cancel', 'MEDIA_CANCELLED'],
    ['chooseMedia:fail auth deny', 'MEDIA_ACCESS_DENIED']]) {
    const media = createMedia({ chooseMedia(options: any) { options.fail({ errMsg: message }); } } as unknown as typeof wx);
    await assert.rejects(media.selectVideo('album'), { code });
  }
});

test('upload reports progress and returns only its expected file ID', async () => {
  const progress: number[] = [];
  let options: any;
  let listener: (event: { progress: number }) => void = () => {};
  const media = createMedia({ cloud: { uploadFile(input: any) {
    options = input;
    return { onProgressUpdate(callback: typeof listener) { listener = callback; }, abort() {} };
  } } } as unknown as typeof wx);
  const handle = media.startUpload(ticket, video, value => progress.push(value));
  assert.equal(options.cloudPath, ticket.cloudPath);
  assert.equal(options.filePath, video.path);
  listener({ progress: 52 });
  options.success({ fileID: ticket.expectedFileId });
  assert.equal(await handle.promise, ticket.expectedFileId);
  assert.deepEqual(progress, [52]);
});

test('cancelling upload aborts the real task and never resolves success', async () => {
  let aborted = false;
  let options: any;
  const media = createMedia({ cloud: { uploadFile(input: any) {
    options = input;
    return { onProgressUpdate() {}, abort() { aborted = true; input.fail({ errMsg: 'uploadFile:fail abort' }); } };
  } } } as unknown as typeof wx);
  const handle = media.startUpload(ticket, video, () => {});
  handle.abort();
  assert.equal(aborted, true);
  options.success({ fileID: ticket.expectedFileId });
  await assert.rejects(handle.promise);
});

test('upload rejects a file ID outside its ticket', async () => {
  let options: any;
  const media = createMedia({ cloud: { uploadFile(input: any) {
    options = input;
    return { onProgressUpdate() {}, abort() {} };
  } } } as unknown as typeof wx);
  const handle = media.startUpload(ticket, video, () => {});
  options.success({ fileID: 'cloud://other.bucket/practice/a/s1/video' });
  await assert.rejects(handle.promise, { code: 'VIDEO_INVALID' });
});
