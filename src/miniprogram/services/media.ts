import type { UploadTicket } from '../../domain/types';
import { validateLocalVideo } from '../../domain/validation';

export type LocalVideo = { path: string; bytes: number; duration: number };
export type UploadHandle = { promise: Promise<string>; abort: () => void };

function mediaError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function createMedia(wxApi: typeof wx) {
  return {
    selectVideo(source: 'album' | 'camera'): Promise<LocalVideo> {
      return new Promise((resolve, reject) => {
        wxApi.chooseMedia({ count: 1, mediaType: ['video'], sourceType: [source], maxDuration: 60,
          success(result) {
            const selected = result.tempFiles[0];
            const video = selected && { path: selected.tempFilePath, bytes: selected.size, duration: selected.duration };
            try {
              validateLocalVideo(video as LocalVideo);
              resolve(video as LocalVideo);
            } catch (error) { reject(error); }
          },
          fail(error) {
            reject(mediaError(/cancel/i.test(error.errMsg) ? 'MEDIA_CANCELLED' : 'MEDIA_ACCESS_DENIED'));
          },
        });
      });
    },
    startUpload(ticket: UploadTicket, video: LocalVideo, onProgress: (percent: number) => void): UploadHandle {
      validateLocalVideo(video);
      let task: WechatMiniprogram.UploadTask | undefined;
      let rejectUpload: (reason: unknown) => void = () => {};
      let aborted = false;
      const promise = new Promise<string>((resolve, reject) => {
        rejectUpload = reject;
        task = wxApi.cloud.uploadFile({ cloudPath: ticket.cloudPath, filePath: video.path,
          success(result) {
            if (aborted) return;
            if (result.fileID !== ticket.expectedFileId) reject(mediaError('VIDEO_INVALID'));
            else resolve(result.fileID);
          },
          fail: reject,
        });
        task.onProgressUpdate(event => onProgress(event.progress));
      });
      return { promise, abort() {
        if (aborted) return;
        aborted = true;
        task?.abort();
        rejectUpload(mediaError('UPLOAD_ABORTED'));
      } };
    },
  };
}
