import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { FileStore } from './repository';

type Response = { status: number; headers: IncomingHttpHeaders; prefix: Buffer };
type CloudStorage = {
  getTempFileURL(input: { fileList: Array<{ fileID: string; maxAge: number }> }):
    Promise<{ fileList: Array<{ fileID: string; tempFileURL: string; maxAge: number; status: number; errMsg: string }> }>;
  deleteFile(input: { fileList: string[] }):
    Promise<{ fileList: Array<{ fileID: string; status: number; errMsg: string }> }>;
};
const maxBytes = 100 * 1024 * 1024;
const missingStatus = -503003;
const supported = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ']);
const failure = (code: string): Error => Object.assign(new Error(code), { code });

function secureUrl(raw: string): boolean {
  try { return new URL(raw).protocol === 'https:'; } catch { return false; }
}

export function readVideoPrefix(url: string, get: typeof https.get = https.get): Promise<Response> {
  if (!secureUrl(url)) return Promise.reject(failure('VIDEO_INVALID'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: ReturnType<typeof https.get>;
    const timer = setTimeout(() => {
      request?.destroy();
      finish(failure('NETWORK_ERROR'));
    }, 10000);
    function finish(error?: Error, value?: Response) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value as Response);
    }
    try {
      request = get(url, { headers: { Range: 'bytes=0-63' }, timeout: 10000 }, response => {
        const status = response.statusCode ?? 0;
        if (status !== 200 && status !== 206) {
          response.destroy();
          finish(failure('VIDEO_INVALID'));
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          const part = Buffer.from(chunk).subarray(0, 64 - length);
          chunks.push(part);
          length += part.length;
          if (length >= 64) {
            response.destroy();
            finish(undefined, { status, headers: response.headers, prefix: Buffer.concat(chunks, length) });
          }
        });
        response.on('end', () => finish(undefined,
          { status, headers: response.headers, prefix: Buffer.concat(chunks, length) }));
        response.on('error', () => finish(failure('NETWORK_ERROR')));
      });
      request.on('error', () => finish(failure('NETWORK_ERROR')));
    } catch { finish(failure('NETWORK_ERROR')); }
  });
}

function totalBytes(response: Response): number {
  const header = response.status === 206 ? response.headers['content-range'] : response.headers['content-length'];
  const text = Array.isArray(header) ? '' : header;
  const match = response.status === 206
    ? /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(text ?? '')
    : /^(\d+)$/.exec(text ?? '');
  const value = Number(match?.[response.status === 206 ? 3 : 1]);
  if (!match || !Number.isSafeInteger(value) || value < 1 || value > maxBytes)
    throw failure('VIDEO_INVALID');
  if (response.status === 206 && (Number(match[1]) !== 0 ||
    Number(match[2]) < response.prefix.length - 1 || Number(match[2]) >= value))
    throw failure('VIDEO_INVALID');
  return value;
}

function isMp4(prefix: Buffer): boolean {
  if (prefix.length < 16 || prefix.toString('ascii', 4, 8) !== 'ftyp') return false;
  const boxSize = prefix.readUInt32BE(0);
  if (boxSize < 16 || boxSize % 4 !== 0) return false;
  for (let position = 8; position + 4 <= Math.min(boxSize, prefix.length); position = position === 8 ? 16 : position + 4) {
    if (supported.has(prefix.toString('ascii', position, position + 4))) return true;
  }
  return false;
}

export function createFileStore(cloud: CloudStorage, request: (url: string) => Promise<Response> = readVideoPrefix,
  now: () => number = Date.now): FileStore {
  async function temporary(fileId: string, maxAge: number) {
    const result = await cloud.getTempFileURL({ fileList: [{ fileID: fileId, maxAge }] });
    const item = result.fileList?.[0];
    if (!item || item.fileID !== fileId) throw failure('VIDEO_INVALID');
    return item;
  }
  return {
    async inspect(fileId) {
      const item = await temporary(fileId, 300);
      if (item.status === missingStatus) throw failure('VIDEO_REQUIRED');
      if (item.status !== 0 || !secureUrl(item.tempFileURL)) throw failure('VIDEO_INVALID');
      const response = await request(item.tempFileURL);
      const bytes = totalBytes(response);
      if (!isMp4(response.prefix)) throw failure('VIDEO_INVALID');
      return { bytes, video: true };
    },
    async playback(fileId) {
      const item = await temporary(fileId, 300);
      if (item.status === missingStatus) throw failure('NOT_FOUND');
      if (item.status !== 0 || !secureUrl(item.tempFileURL)) throw failure('VIDEO_INVALID');
      if (!Number.isFinite(item.maxAge) || item.maxAge <= 0) throw failure('VIDEO_INVALID');
      return { url: item.tempFileURL, expiresAt: now() + Math.min(item.maxAge, 300) * 1000 };
    },
    async remove(fileId) {
      const result = await cloud.deleteFile({ fileList: [fileId] });
      const item = result.fileList?.[0];
      if (!item || item.fileID !== fileId || (item.status !== 0 && item.status !== missingStatus))
        throw failure('CLOUD_UNAVAILABLE');
    },
  };
}
