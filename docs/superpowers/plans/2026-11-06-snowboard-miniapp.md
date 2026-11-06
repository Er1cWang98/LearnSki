# 单板滑雪学习小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可在微信开发者工具中运行的学习小程序，支持入门课程、私有练习视频、自评打卡、顺序解锁及练习记录。

**Architecture:** 原生小程序展示版本化课程；共享纯函数处理进度。云函数验证身份、文件和考核，事务保存练习及首次完成凭证。云存储保存私有视频，单独的定时函数处理过期上传及删除补偿。

**Tech Stack:** WXML、WXSS、TypeScript 5.9.3、esbuild 0.25.12、tsx 4.20.6、Node 内置测试框架、miniprogram-api-typings 5.2.3、wx-server-sdk 4.0.2。

**Spec:** `docs/superpowers/specs/2026-11-06-snowboard-miniapp-design.md`。执行前同时阅读设计及本计划，不能只看单个任务。

## Global Constraints

- “第一版交付学习路线、课程详情、视频练习打卡、个人练习记录四项能力。”
- “共 11 课，其中必修 10 课、选修 1 课。选修课和 intro-07 在 intro-05 完成后同时开放。”
- “课程完成统一称为‘自评完成’。”产品文案实际使用中文双引号或不带引号均可。
- “产品默认每次记录一个视频，最长 3 分钟、最大 100 MB，心得最长 500 字。”代码将 100 MB 定义为 100 × 1024 × 1024 字节，页面显示“100 MB”；长度按 Unicode 码点计数。
- “拍摄入口保守设置为最多 60 秒；相册导入仍执行最多 3 分钟的产品限制。”
- “无视频时只能保留本机草稿，不生成正式练习记录或完成进度。”
- “已获得的课程完成状态保留，删除记录不重新锁课。”
- “业务数据库禁止客户端直接读写，由云函数统一执行所有者校验。”
- “正式模式不能静默返回假上传成功或本地模拟完成。”
- “所有首版课程初始为 draft，公开教学发布前需完成内容校对并更新状态。”
- 当前阶段实施的是功能与开发预览；不自动创建付费资源或公开发布，不把未执行的真机检查标为通过。

## 执行顺序与现有环境

任务依次为 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。任务 8 是整体交付验收，不能因为前面单元测试通过而省略。

当前仓库仅有设计文档，分支 develop，工作目录由 Orca 提供。执行开始时读取 using-git-worktrees 技能并检查 `git rev-parse --git-dir`、`git rev-parse --git-common-dir`，已处于关联工作树时复用，不创建嵌套工作树。

本机已发现 Node v21.7.3、npm 10.5.0。该版本只作为本地工具运行环境的实际记录，不声称是受支持的长期部署运行时。已查询固定依赖：TypeScript 要求 Node >=14.17，esbuild 和 tsx 要求 Node >=18；构建先在本机验证。云函数构建目标为 Node 18 语法，部署选择云平台实际提供的兼容 Node 运行时并记录版本。

采用 Node 内置测试框架，避免为测试增加浏览器或第三方测试运行器。代码测试使用 `node --import tsx --test <明确的测试路径>`；全量测试通过 `scripts/test.mjs` 搜集 tests 下的 `.test.ts`，再用 `spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {stdio:'inherit'})` 执行，禁止依赖 Windows shell 的通配符展开。

## 文件职责

| 路径 | 职责 |
|---|---|
| `src/catalog/intro.ts` | 11 课唯一内容源、来源标注、阶段目录 |
| `src/domain/types.ts` | 课程、进度、记录、上传及服务契约 |
| `src/domain/progress.ts` | 解锁、计数、下一课纯函数 |
| `src/domain/validation.ts` | 视频限制、考核、心得、版本校验 |
| `src/miniprogram/app.ts`、`app.json`、`app.wxss` | 入口、双标签导航、全局视觉变量 |
| `src/miniprogram/pages/{learn,lesson,practice,mine,record}/` | 每页的 index.ts、index.json、index.wxml、index.wxss |
| `src/miniprogram/services/cloud.ts` | RPC、显式云配置检查、业务错误映射 |
| `src/miniprogram/services/media.ts` | 选择视频、可取消上传、上传进度 |
| `src/miniprogram/services/drafts.ts` | 带账号作用域的本机草稿、临时路径失效处理 |
| `src/miniprogram/presenters/{learning,practice,records}.ts` | 可在 Node 下测试的页面状态与操作协调 |
| `src/server/service.ts` | 业务入口，依赖注入事务仓库和文件服务 |
| `src/server/{repository,files}.ts` | 数据库事务、文件校验与播放适配器 |
| `src/server/{entry,maintenance-entry}.ts` | 用户云函数入口、定时任务入口 |
| `src/server/maintenance.ts` | 删除补偿、过期上传清理 |
| `tests/helpers/fakes.ts` | 串行事务内存仓库、文件服务替身、故障注入 |
| `tests/{catalog,progress,validation,learning,server,media,files,practice,records,maintenance,build}.test.ts` | 对应行为测试 |
| `scripts/{build,test}.mjs` | 打包小程序与云函数、跨平台运行测试 |
| `config/{database.rules,storage.rules}.json` | 部署所需权限规则 |
| `config/cloud.example.json`、生成的 `dist/project.config.json` | 无凭据的配置示例和工具导入配置 |
| `README.md`、`docs/acceptance.md` | 启动、配置、部署及实际验收记录 |
| `dist/miniprogram/`、`dist/cloudfunctions/{learning,maintenance}/` | 构建产物，忽略进 Git |

## 共享类型和 API 契约

以下类型由任务 1、3 创建，后续任务复用，不另起字段名。服务端 wire 数据只传 JSON，时间统一为服务端生成的毫秒时间戳。

```ts
export type Outcome = 'practicing' | 'selfCompleted';
export type Criterion = { id: string; text: string };
export type Lesson = {
  id: string; stageId: string; order: number; optional: boolean;
  prerequisiteIds: string[]; version: number; reviewStatus: 'draft' | 'reviewed';
  title: string; goal: string; steps: string[]; keyPoints: string[];
  commonMistakes: string[]; criteria: Criterion[];
  source: 'user-notes' | 'editorial-draft';
  media: null | { type: 'video' | 'gif'; src: string; poster?: string };
};
export type Completion = {
  lessonId: string; lessonVersion: number; firstCompletedAt: number;
  sourceRecordId: string | null;
};
export type Progress = {
  completedIds: string[]; requiredDone: number; requiredTotal: number;
  nextLessonId: string | null; stageComplete: boolean;
};
export type PracticeRecord = {
  id: string; lessonId: string; lessonVersion: number;
  criteriaSnapshot: Criterion[]; checkedIds: string[]; note: string;
  result: Outcome; createdAt: number;
};
export type UploadTicket = {
  id: string; cloudPath: string; expectedFileId: string; expiresAt: number;
};
export type CommitInput = {
  sessionId: string; fileId: string; lessonVersion: number;
  checkedIds: string[]; note: string; result: Outcome;
};
export type RecordPage = { items: PracticeRecord[]; nextCursor: string | null };
export type LearningApi = {
  getProgress(): Promise<{ scope: string; progress: Progress }>;
  createUpload(input: { lessonId: string; lessonVersion: number }): Promise<UploadTicket>;
  commit(input: CommitInput): Promise<{ record: PracticeRecord; progress: Progress }>;
  listRecords(input: { lessonId?: string; cursor?: string; limit: number }): Promise<RecordPage>;
  getRecord(id: string): Promise<PracticeRecord>;
  getPlayback(id: string): Promise<{ url: string; expiresAt: number }>;
  deleteRecord(id: string): Promise<{ state: 'deleted' | 'deleting' }>;
};
```

服务端文档额外包含 `ownerId`、视频 fileId、删除状态，不能把完整数据库文档直接返回客户端。`scope` 为服务端根据可信用户身份计算的 SHA-256 摘要，用于本地缓存隔离，不接受客户端用它指定所有者。客户端传来的任何 ownerId 均忽略或拒绝，服务端从 `getWXContext().OPENID` 取得身份。

服务错误为 `{code:string,message:string}`；固定代码：`CLOUD_UNAVAILABLE`、`UNAUTHENTICATED`、`LESSON_LOCKED`、`VERSION_CHANGED`、`INVALID_INPUT`、`VIDEO_REQUIRED`、`VIDEO_INVALID`、`UPLOAD_EXPIRED`、`UPLOAD_IN_PROGRESS`、`CHECKLIST_INCOMPLETE`、`NOT_FOUND`、`RECORD_DELETED`、`CONFLICT`、`NETWORK_ERROR`。界面映射为中文，不展示内部路径或堆栈。

## Task 1：可构建的课程目录与进度核心

**Files:** 创建 package.json、package-lock.json、tsconfig.json、.gitignore、scripts/build.mjs、scripts/test.mjs、src/catalog/intro.ts、src/domain/types.ts、src/domain/progress.ts、tests/catalog.test.ts、tests/progress.test.ts。

**Interfaces:** 输出 `lessons: Lesson[]`、`isUnlocked(lessonId: string, completedIds: string[]): boolean`、`getProgress(completions: Completion[]): Progress`、`getLesson(lessonId: string): Lesson`。未知课程 ID 抛出 NOT_FOUND；课程排序取 order，不依赖数组碰巧有序。

- [ ] 1. 创建依赖与脚本，运行 `npm install`。固定开发依赖为 typescript 5.9.3、esbuild 0.25.12、tsx 4.20.6、miniprogram-api-typings 5.2.3、@types/node 20.19.0；wx-server-sdk 4.0.2 作为服务端依赖。scripts 为 `test: node scripts/test.mjs`、`typecheck: tsc --noEmit`、`build: node scripts/build.mjs`。tsconfig 使用 strict、target ES2018、module commonjs、moduleResolution node、esModuleInterop true；包含 src 与 tests，排除 dist。
- [ ] 2. 写下列进度测试，先运行 `node --import tsx --test tests/progress.test.ts`，确认因导出尚不存在失败，而非依赖安装问题。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getProgress, isUnlocked } from '../src/domain/progress';
import type { Completion } from '../src/domain/types';
const completed = (id: string): Completion => ({
  lessonId: id, lessonVersion: 1, firstCompletedAt: 1, sourceRecordId: null,
});
test('选修不阻塞必修，重复完成不增加进度', () => {
  const ids = ['intro-01', 'intro-02', 'intro-03', 'intro-04', 'intro-05'];
  assert.equal(isUnlocked('intro-06', ids), true);
  assert.equal(isUnlocked('intro-07', ids), true);
  assert.equal(isUnlocked('intro-08', ids), false);
  const progress = getProgress([...ids, 'intro-05', 'intro-06'].map(completed));
  assert.equal(progress.requiredDone, 5);
  assert.equal(progress.requiredTotal, 10);
  assert.equal(progress.nextLessonId, 'intro-07');
});
```

- [ ] 3. 按设计目录创建 11 课，保留截图能确认的素材来源；编辑补写内容设为草稿。每课提供具体目标、分步讲解、关键点、常见错误和稳定 ID 考核项；不把所有课程替换为同一段泛化文案。安全摔倒及后半段缺少原文的课，草稿说明必须显式保留。媒体设为 null。
- [ ] 4. 以以下算法实现进度；补齐首课、全部必修完成、未知课程以及已删除 sourceRecordId 不影响进度的测试。

```ts
export function getProgress(completions: Completion[]): Progress {
  const valid = new Set(lessons.map(lesson => lesson.id));
  const done = new Set(completions.map(item => item.lessonId).filter(id => valid.has(id)));
  const required = lessons.filter(lesson => !lesson.optional).sort((a, b) => a.order - b.order);
  const requiredDone = required.filter(lesson => done.has(lesson.id)).length;
  return {
    completedIds: [...done], requiredDone, requiredTotal: required.length,
    nextLessonId: required.find(lesson => !done.has(lesson.id) &&
      lesson.prerequisiteIds.every(id => done.has(id)))?.id ?? null,
    stageComplete: requiredDone === required.length,
  };
}
```

- [ ] 5. 目录校验测试检查 ID 唯一、前置引用存在且无环、必修路径能到达终点、选修移除后路径不受阻、考核 ID 稳定且非空。检查两个方向合并课程的考核没有漏掉一个方向。
- [ ] 6. 构建脚本使用 esbuild 的 bundle 模式，为每个小程序 TS 入口单独生成 commonjs JavaScript；复制 JSON/WXML/WXSS 到同目录。服务端打包 platform node、target node18，external 保留 wx-server-sdk；在每个云函数目录生成含精确依赖的 package.json。将 dist、node_modules、config/cloud.local.json、project.private.config.json 加入 .gitignore。构建前清理仅限已验证位于工作目录内的 dist 路径。
- [ ] 7. 运行课程与进度测试及 `npm run typecheck`，确认通过后提交 `feat: add beginner curriculum and progression rules`。

## Task 2：学习首页、课程详情与无云状态

**Files:** 创建 src/miniprogram/app.ts、app.json、app.wxss、pages/learn/index.{ts,json,wxml,wxss}、pages/lesson/index.{ts,json,wxml,wxss}、pages/mine/index.{ts,json,wxml,wxss}、presenters/learning.ts、services/cloud.ts、config/cloud.example.json、tests/learning.test.ts；补充 scripts/build.mjs 生成 dist/project.config.json。

**Interfaces:** `toLessonView(lesson: Lesson, progress: Progress | null)` 返回 `{id,title,goal,status,showFullContent,actionLabel}`；status 为 locked/available/completed/unknown；`createApi(envId: string): LearningApi` 的所有未配置云操作拒绝 CLOUD_UNAVAILABLE。页面从本地课程源读取教学，不需要云才能打开。

- [ ] 1. 先写并运行 `node --import tsx --test tests/learning.test.ts`，覆盖“未知云进度不显示为零”“锁定只展示简介”“已完成可复习”。

```ts
test('未知进度仍可阅读首课，但不能假定后续课程已解锁', () => {
  const first = toLessonView(getLesson('intro-01'), null);
  const second = toLessonView(getLesson('intro-02'), null);
  assert.equal(first.showFullContent, true);
  assert.equal(second.status, 'unknown');
  assert.equal(second.showFullContent, false);
});
```

- [ ] 2. 实现 presenter：完成状态优先；有可信进度时计算前置；未知进度仅显示无前置课全文，保留其他课简介。页面再次 onShow 时请求进度；只有本次启动已经验证 scope，才可在后续网络失败时保留同账号缓存并标注未更新。启动后尚未验证身份时，不从本地缓存推断当前用户；显示“进度暂不可用”。
- [ ] 3. 建立两标签导航、路线卡片和课程页面。默认视觉使用浅灰背景、深蓝文字、青绿色主按钮、大于等于 44px 的触控区，课程状态同时有图标和中文文字。以下媒体分支不能渲染假的播放控件：

```xml
<view wx:if="{{!lesson.media}}" class="media-empty">教学视频待补充</view>
<video wx:elif="{{lesson.media.type === 'video'}}" src="{{lesson.media.src}}" controls />
<image wx:else src="{{lesson.media.src}}" mode="widthFix" />
<view wx:if="{{lesson.reviewStatus === 'draft'}}" class="draft-label">课程草稿，待教练校对</view>
```

- [ ] 4. app.json 先声明已经实现的 learn、lesson、mine 三页，后续创建 practice 和 record 时同时注册路由，禁止声明不存在的页面。cloud.example.json 内容为 `{"appId":"touristappid","envId":"","fileIdPrefix":""}`；构建读取可选 cloud.local.json，生成 dist/project.config.json 和客户端仅含 envId 的配置。默认使用工具的游客导入方式，真实云调用需用户 AppID。服务端 fileIdPrefix 不打入客户端；任何凭据都不进入构建产物。
- [ ] 5. 运行 `npm run typecheck` 和学习页面测试，构建后检查 WXML/JSON 结构；提交 `feat: add learning route and lesson pages`。

## Task 3：服务端身份、事务和打卡验证

**Files:** 创建 src/domain/validation.ts、src/server/service.ts、repository.ts、entry.ts、tests/helpers/fakes.ts、tests/validation.test.ts、tests/server.test.ts；补齐 types.ts。

**Interfaces:** 本任务输出 `CheckInApi = Pick<LearningApi,'getProgress'|'createUpload'|'commit'>`，以及 `createService(deps: ServiceDeps).forUser(ownerId: string): CheckInApi`、`createRepository(db): Repository`、`validateCommit(lesson: Lesson,input: CommitInput): void`。Task 6 增加记录操作后扩展为完整 LearningApi。所有涉及用户的调用均来自 forUser 闭包；云入口只允许已实现且列在契约中的 action。

仓库契约在 repository.ts 明确定义：

```ts
export interface Transaction {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, value: T): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}
export interface Repository {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  listOwned<T>(collection: string, ownerId: string,
    options: { lessonId?: string; before?: { createdAt: number; id: string }; limit: number }): Promise<T[]>;
  listCleanupCandidates(now: number, limit: number):
    Promise<Array<{collection:'uploads'|'practices';id:string}>>;
}
export interface FileStore {
  inspect(fileId: string): Promise<{ bytes: number; video: boolean }>;
  playback(fileId: string): Promise<{ url: string; expiresAt: number }>;
  remove(fileId: string): Promise<void>;
}
export interface ServiceDeps {
  repository: Repository; files: FileStore; now: () => number;
  randomId: () => string; fileIdPrefix: string;
}
```

数据库集合为 uploads、practices、completions；确定性完成凭证 ID 为 SHA-256(ownerId + ':' + lessonId)。服务端记录包含可信 ownerId；scope 取 SHA-256(ownerId)。不依赖服务端写入自动生成 `_openid`。

- [ ] 1. 先创建内存仓库及文件替身：transaction 使用 FIFO Promise 锁，克隆当前 Map 为事务快照，回调抛错则丢弃快照，成功才替换；文件替身保存 `{bytes,video}`，可设置 inspect/remove 失败。提供 `createHarness()`，返回 `{apiA,apiB,repository,files,advanceTime,failNextCommit,seedCompletions}`；apiA/apiB 的身份分别固定为 user-a/user-b，种子方法仅属于 tests。
- [ ] 2. 写云业务失败测试并运行 `node --import tsx --test tests/validation.test.ts tests/server.test.ts`：缺视频、未知考核 ID、未全勾选完成、伪造版本、锁定课程、他人上传会话、他人 fileId 均拒绝。

```ts
test('只有完整自评解锁下一课，重试不重复计数', async () => {
  const h = createHarness();
  const ticket = await h.apiA.createUpload({lessonId:'intro-01',lessonVersion:1});
  h.files.put(ticket.expectedFileId, {bytes:1024,video:true});
  const input: CommitInput = {
    sessionId:ticket.id,fileId:ticket.expectedFileId,lessonVersion:1,
    checkedIds:getLesson('intro-01').criteria.map(item => item.id),
    note:'第一次练习',result:'selfCompleted',
  };
  const [a,b] = await Promise.all([h.apiA.commit(input),h.apiA.commit(input)]);
  assert.equal(a.record.id,b.record.id);
  assert.equal(a.progress.requiredDone,1);
  assert.equal((await h.repository.listOwned('practices','user-a',{limit:20})).length,1);
  await assert.rejects(h.apiB.commit(input), {code:'NOT_FOUND'});
});
```

- [ ] 3. 实现 getProgress：读取当前用户的 completions、调用共享纯函数并返回 scope。实现 createUpload：校验用户、课程版本、前置，随机 UUID 会话；路径 `practice/<ownerId>/<sessionId>/video`，expectedFileId 由服务端配置的完整云文件前缀和路径拼接；expiresAt 为服务端 now + 24 小时；只允许 issued 状态进入提交。PracticeRecord.id 直接使用 sessionId，使重试、删除及墓碑核对都能直接定位对应会话。
- [ ] 4. 实现 validateCommit：result 限定两值、note 码点不超过 500、checkedIds 去重后全部属于当前课程、版本相同、自评完成必须覆盖全部考核。保存练习允许部分或零项；lessonId 取会话，不接受提交请求另传课程改变归属。
- [ ] 5. inspect 在事务外执行，事务内重新检查会话状态及过期时间。实际原子写入顺序：读取会话和前置完成凭证 → 校验 → 写 practices → 若首次完成则写 completions → 会话改 consumed 并写 recordId、提交输入摘要。重试命中 consumed 时校验请求摘要相同，返回原记录；不同请求返回 CONFLICT，记录已删除返回 RECORD_DELETED。一个会话不能先保存练习、再变更请求冒充新完成；重新练习创建新会话。
- [ ] 6. 补充事务回滚、并发两次不同练习首次完成同一课程、响应丢失、服务时间过期和丢失身份测试。事务内全部读完后再写，避免数据库事务读写顺序限制。sdk 适配器捕获“文档不存在”才返回 null；网络或权限错误必须向上传递，不能当成空记录。
- [ ] 7. entry.ts 初始化 wx-server-sdk DYNAMIC_CURRENT_ENV；从可信上下文取 OPENID，缺失则 UNAUTHENTICATED。action 使用静态分发表，拒绝原型属性或未知 action。返回 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`；业务数据之外不输出原始异常。运行服务端与验证测试、类型检查，提交 `feat: enforce authenticated transactional check-ins`。

## Task 4：可取消的真实视频上传与私有存储

**Files:** 创建 src/miniprogram/services/media.ts、src/server/files.ts、config/storage.rules.json、config/database.rules.json、tests/media.test.ts、tests/files.test.ts；补充 src/domain/validation.ts、src/server/entry.ts。

**Interfaces:** `selectVideo(source: 'album' | 'camera'): Promise<LocalVideo>`，`startUpload(ticket: UploadTicket,video: LocalVideo,onProgress:(percent:number)=>void): UploadHandle`；`LocalVideo = {path:string,bytes:number,duration:number}`；`UploadHandle = {promise:Promise<string>,abort:()=>void}`。`createFileStore(cloud,request): FileStore` 接受 SDK 和可测试的 HTTP transport，返回 Task 3 定义的 FileStore。

- [ ] 1. 定义测试替身注入点 `createMedia(wxApi)`，测试 cloud.uploadFile 返回的 UploadTask 是否用于进度和取消，而不是被误当成 Promise。运行 `node --import tsx --test tests/media.test.ts tests/files.test.ts`，先看到缺少实现失败。

```ts
test('取消上传调用真实任务的 abort，且不返回成功 fileId', async () => {
  let aborted = false;
  let fail: (error: {errMsg:string}) => void = () => {};
  const cloud = {
    uploadFile(options: {fail:typeof fail}) {
      fail = options.fail;
      return {
        onProgressUpdate() {},
        abort() { aborted = true; fail({errMsg:'uploadFile:fail abort'}); },
      };
    },
  };
  const media = createMedia({cloud} as unknown as typeof wx);
  const handle = media.startUpload(
    {id:'s1',cloudPath:'practice/a/s1/video',expectedFileId:'cloud://env.bucket/practice/a/s1/video',expiresAt:1000},
    {path:'wxfile://sample.mp4',bytes:1024,duration:10}, () => {},
  );
  handle.abort();
  await assert.rejects(handle.promise);
  assert.equal(aborted,true);
});
```

- [ ] 2. 实现选择：`wx.chooseMedia({count:1,mediaType:['video'],sourceType:[source],maxDuration:60})`；返回数据提取 tempFiles[0] 的 tempFilePath、size、duration。相册导入完成后再检查 <=180 秒、<=104857600 字节；拍摄入口显示“最多 60 秒”。取消选择恢复原表单，拒绝访问显示对应错误，不自动弹设置页面。
- [ ] 3. 上传调用必须提供 success/fail 回调，以取得 UploadTask；返回 promise 只封装结果，不覆盖上传任务本身。核心结构如下：

```ts
let task: WechatMiniprogram.UploadTask | undefined;
const promise = new Promise<string>((resolve,reject) => {
  task = wx.cloud.uploadFile({
    cloudPath:ticket.cloudPath,filePath:video.path,
    success:result => resolve(result.fileID),fail:reject,
  });
  task.onProgressUpdate(event => onProgress(event.progress));
});
return {promise,abort:() => task?.abort()};
```

- [ ] 4. 实现服务端 inspect。先对 expectedFileId 做精确匹配，不接受任意客户端 URL。通过 SDK getTempFileURL 获取可信的单文件地址，只使用 https，发 Range `bytes=0-63`，超时 10 秒；限制最多读取 64 字节后关闭连接，不能把 100 MB 文件整体读入内存。对于 206，长度来自 Content-Range 的总大小；对于 200，长度来自 Content-Length；缺少可信大小返回 VIDEO_INVALID。4–7 字节必须是 `ftyp`，主品牌或兼容品牌必须包含 isom、iso2、iso4、iso5、iso6、mp41、mp42、avc1、M4V（补一个空格）或 qt（补两个空格）之一。此处 FileStore.inspect 的 video 布尔字段只代表支持的媒体容器签名，不代表已解析视频轨道或动作内容；不能仅看后缀或 Content-Type。媒体时长在客户端检查，不声称服务端已解析时长。
- [ ] 5. 给 transport 写测试：有效 MP4、HTML 冒充视频、超限长度、未知长度、SDK 文件不存在、异常重定向均拒绝不合格文件；重定向不自动追随。playback 使用同一 SDK 取得最长 5 分钟的按需播放地址，检查 fileList[0].status；remove 检查逐文件删除状态，仅明确“文件不存在”可按幂等成功处理。
- [ ] 6. 数据库规则写入 `{"read":false,"write":false}`，仅服务端访问业务集合。存储规则使用官方所有者规则，再限制 practice 路径：

```json
{
  "read": "auth != null && resource.openid == auth.openid",
  "write": "auth != null && resource.openid == auth.openid && /^practice\\//.test(resource.path)"
}
```

这条规则限制存储对象的实际创建者与命名空间；服务端再验证可信用户绑定的 UploadSession 和完整 expectedFileId，不能只检查路径前缀。部署时必须在控制台规则校验器通过，并验证新建、读取、覆盖、删除四种操作；规则表达式若不被当前环境接受，不允许退回公开读写规则。
- [ ] 7. 私有文件直接存储读取与云函数读取都需要两账号实测。未配置云环境时，将此项记为“未执行”，不能用 FileStore 替身测试推断线上权限已生效。运行媒体/文件测试与类型检查，提交 `feat: add cancellable private video uploads`。

## Task 5：练习表单、草稿和完整打卡流程

**Files:** 创建 src/miniprogram/pages/practice/index.{ts,json,wxml,wxss}、presenters/practice.ts、services/drafts.ts、tests/practice.test.ts；修改 app.json、pages/lesson/index.ts、services/cloud.ts。

**Interfaces:** `createPracticeController({api,media,drafts,lesson,scope,onChange})` 输出 `setChecked(ids:string[])`、`setNote(note:string)`、`choose(source)`、`submit(result:Outcome)`、`cancelUpload()`、`dispose()`。状态为 `{phase:'editing'|'selecting'|'uploading'|'submitting'|'success',checkedIds,note,video,percent,error,recordId}`。`DraftStore` 定义 `load(scope,lessonId)`、`save(scope,lessonId,draft)`、`remove(scope,lessonId)`；draft 保存版本、勾选、心得、临时路径、会话和提交输入快照，不保存播放 URL。

- [ ] 1. 写状态机测试并运行 `node --import tsx --test tests/practice.test.ts`。用 deferred Promise 控制上传/提交完成顺序，确保 UI 不提前显示完成；测试并发点击只调用一次 commit、取消上传恢复编辑、上传失败可重试、提交响应丢失重用 sessionId。

```ts
test('提交未成功时不能显示完成', async () => {
  const h = createPracticeHarness();
  await h.controller.choose('album');
  h.controller.setChecked(getLesson('intro-01').criteria.map(item => item.id));
  const submitting = h.controller.submit('selfCompleted');
  await h.untilPhase('submitting');
  assert.equal(h.state().recordId,null);
  assert.notEqual(h.state().phase,'success');
  h.resolveCommit();
  await submitting;
  assert.equal(h.state().phase,'success');
});
```

`createPracticeHarness()` 只存在于 tests/helpers/fakes.ts：使用 Task 3 的 apiA 包装 commit 的 deferred Promise，media 替身选择一段 10 秒视频并立即上传，state 收集 onChange；untilPhase 在 onChange 中解决 Promise，不靠定时轮询。
- [ ] 2. 实现顺序：获取可信 scope 和课程状态 → 恢复同账号同课程草稿 → 选择视频 → 创建会话 → 上传 → 服务端提交 → 成功后清草稿、刷新进度、显示下一课。选择/替换文件时废弃旧会话，新会话独立；旧文件由清理任务处理。
- [ ] 3. 完成打卡按钮要求全部勾选，保存练习按钮允许未全勾选，两者都要求有效视频。上传和提交时锁定会影响提交语义的字段。网络失败后保持已冻结的提交快照并允许重试；用户选择修改时开启新练习，不能修改 consumed 会话的请求摘要。
- [ ] 4. 将 drafts 实现为 wx 存储，key 为 `practice:<scope>:<lessonId>`。没有可信 scope 时不恢复其他用户草稿；首次云连接不可用只允许保存在本次内存。临时路径恢复时用 FileSystemManager.access 检查存在；不存在则保留文字和考核但清除本地视频。已上传成功但响应丢失的提交可用保存的会话重试，不要求临时文件仍存在。
- [ ] 5. 课程版本变化时保留心得、视频，清空已勾选项并要求重新确认。会话在服务端允许更新至当前版本之前保持不可提交；客户端可请求新会话重新上传，以免悄悄复用旧版本提交。离开页面时保存草稿并取消正在上传的任务；已发出的云提交不声称能取消，回页时通过原会话重试确认结果。
- [ ] 6. 创建 WXML 表单和视频预览、相册/拍摄入口、上传进度、心得计数、两个提交按钮及错误重试。提交成功显示“练习已保存”或“自评完成”，只有后者显示新解锁提示。注册 practice 路由，lesson 已解锁入口进入该页，已完成课程入口为“再练一次”。
- [ ] 7. 覆盖临时文件失效、账号作用域变化、500 个中文字符、取消、版本变化及草稿清除测试。运行 practice/media/server 测试、类型检查及构建，提交 `feat: complete video practice and check-in flow`。

## Task 6：个人记录、私有播放及删除补偿

**Files:** 完善 pages/mine/index.{ts,json,wxml,wxss}；创建 pages/record/index.{ts,json,wxml,wxss}、presenters/records.ts、tests/records.test.ts；修改 app.json、src/server/service.ts、repository.ts、tests/server.test.ts。

**Interfaces:** 使用既有 listRecords/getRecord/getPlayback/deleteRecord；`createRecordsController(api)` 提供 `load(lessonId?:string)`、`loadMore()`、`remove(id:string)`；每次筛选生成请求序号，迟到旧响应不得覆盖当前筛选。详情页调用 getRecord 后按需 getPlayback，不在列表批量生成视频地址。

本任务将 createService(...).forUser(...) 从 CheckInApi 扩展为完整 LearningApi，云入口同时注册这四个记录操作；不得先暴露未实现的 action。

- [ ] 1. 写测试：账号 B 读取 A 的 record/playback/delete 都返回 NOT_FOUND；课程筛选不混入其他课；空列表与网络失败呈现不同状态；相同时间记录分页不重漏；删除后必修进度仍为 1。

```ts
test('删除个人练习保留完成凭证，同时移除视频', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  await assert.rejects(h.apiB.getPlayback(record.id), {code:'NOT_FOUND'});
  const result = await h.apiA.deleteRecord(record.id);
  assert.equal(result.state,'deleted');
  assert.equal((await h.apiA.getProgress()).progress.requiredDone,1);
  assert.equal((await h.apiA.listRecords({limit:20})).items.length,0);
  await assert.rejects(h.apiA.getRecord(record.id),{code:'NOT_FOUND'});
});
```

`completeFirstLesson(h)` 是 tests/helpers/fakes.ts 中的辅助函数：按 Task 3 测试创建 intro-01 会话、存入 1024 字节有效视频、全勾选提交，返回 record。

- [ ] 2. listRecords 强制 ownerId，limit 限制在 1–20；按 createdAt 降序、id 降序排序，用 `{createdAt,id}` 编码游标。解析游标验证字段和范围，不允许游标夹带查询条件。获取 limit+1 判定是否还有下一页。排除 deleting 状态；建立 ownerId/state/createdAt/id 和 ownerId/lessonId/state/createdAt/id 两组索引。
- [ ] 3. getRecord/getPlayback 均从数据库以 id 读取并核对 ownerId 和 active 状态；缺失或非本人返回同一 NOT_FOUND。playback 获取短期 URL，不写数据库或日志；视频组件报错时允许刷新一次地址，仍失败显示重试，避免自动无限循环。
- [ ] 4. 删除先在事务内标记 deleting、写入 deletionRequestedAt，再调用 files.remove；删除成功在事务内移除 practice 文档并将完成凭证引用置 null，会话保留 consumed 墓碑和 recordId 以阻止旧提交复活。第二次删除同一 ID 只有能通过该用户会话墓碑核实归属时幂等成功；未知 ID 或其他用户 ID 返回 NOT_FOUND。
- [ ] 5. 删除文件失败返回 deleting，列表隐藏该记录，详情显示处理中；Task 7 定时任务完成补偿。不能在客户端成功 toast 后仍把删除失败的记录当作永久完成处理。mine 统计练习次数只计 active 记录，已完成课程数来自 completions。
- [ ] 6. 实现我的概览、课程筛选、记录列表、加载更多、空态、错误重试和详情页；删除按钮先展示“删除这条记录和视频？已完成进度会保留。”确认后才调用服务端。注册 record 路由。
- [ ] 7. 运行 records/server 测试及类型检查、构建，提交 `feat: add private practice history and deletion`。

## Task 7：过期文件清理和定时任务隔离

**Files:** 创建 src/server/maintenance.ts、maintenance-entry.ts、tests/maintenance.test.ts；修改 repository.ts、scripts/build.mjs；创建 config/maintenance.trigger.json。

**Interfaces:** `runMaintenance(deps: ServiceDeps,limit:number): Promise<{removed:number,failed:number,skipped:number}>`；后台条目处理重复执行安全，不接受客户端传入 ownerId、任意 fileId 或路径作为删除目标。

服务端 UploadSession 除 UploadTicket 字段外包含 ownerId、lessonId、lessonVersion、state、recordId、commitDigest；state 为 issued/consumed/cleaning/expired。Practice 文档有 active/deleting 状态。cleanup 查询根据这些状态及时间，不以客户端提供的文件列表为依据。

- [ ] 1. 为过期未提交、未过期、已消费、删除失败重试、清理与提交争抢同一会话写测试；运行 `node --import tsx --test tests/maintenance.test.ts` 观察实现缺失失败。

```ts
test('清理不会删除已打卡视频，且失败可重试', async () => {
  const h = createHarness();
  const saved = await completeFirstLesson(h);
  const unused = await h.apiA.createUpload({lessonId:'intro-02',lessonVersion:1});
  h.files.put(unused.expectedFileId,{bytes:1024,video:true});
  h.advanceTime(25 * 60 * 60 * 1000);
  h.files.failNextRemove();
  const first = await runMaintenance(h.deps,100);
  assert.equal(first.failed,1);
  const second = await runMaintenance(h.deps,100);
  assert.equal(second.removed,1);
  assert.equal(h.files.has(unused.expectedFileId),false);
  assert.equal((await h.apiA.getRecord(saved.id)).id,saved.id);
});
```

扩展 createHarness 返回 deps；FileStore 替身增加 has 与 failNextRemove。失败只作用于下一次删除，不能影响其他测试实例。

- [ ] 2. 对过期 issued 会话：事务重新读取状态与 expiresAt，原子改 cleaning，事务外删除 expectedFileId，成功后事务改 expired；失败保持 cleaning，后续任务重试。committer 必须在事务中拒绝 cleaning/expired，清理必须跳过 consumed；并发运行测试验证两者仅一个成功。
- [ ] 3. 对 deleting 记录：重新核对状态，删除文件后清除记录及完成引用；失败保留，沿用 Task 6 的同一个删除核心函数，避免两份逻辑。该内部函数命名 `finishDeletion(deps,ownerId,recordId)` 并只接受从服务端数据库读取的 ownerId。
- [ ] 4. 每轮最多处理 100 项，查询分页与处理分批，已知错误记录结构化计数及匿名 ID，不记录 URL/心得。为 uploads(state,expiresAt) 和 practices(state,deletionRequestedAt) 建索引。清理失败不妨碍其他条目继续，函数整体返回真实计数。
- [ ] 5. maintenance-entry 只能作为可信定时任务或管理调用：拒绝 `getWXContext().OPENID` 非空的用户调用，校验 event.Type 为 Timer、TriggerName 为 cleanup-expired。不能仅根据客户端可伪造的 event 字段授权。部署定时配置每小时运行一次，并核对实际定时事件结构；可从控制台管理身份触发一次进行验证，用户 RPC 分发表没有 maintenance 入口。
- [ ] 6. 测试伪造定时 event 的客户端被拒绝、清理事务中途失败不删除关联视频、文件已经不存在时幂等成功。构建独立 maintenance 云函数，运行测试及类型检查，提交 `feat: clean expired uploads and retry deletions`。

## Task 8：完整构建、开发者工具交付与真实验收

**Files:** 创建 README.md、docs/acceptance.md、tests/build.test.ts；完善 scripts/build.mjs、生成的 dist/project.config.json、config/maintenance.trigger.json 和全部页面；更新设计文档技术资料核对部分。

**Interfaces:** `npm ci`、`npm test`、`npm run typecheck`、`npm run build` 是可复现入口。微信开发者工具导入 dist 目录；其中 project.config.json 的 miniprogramRoot 为 miniprogram/、cloudfunctionRoot 为 cloudfunctions/。每个部署函数的依赖必须由其自身 package.json 安装，不假定云端存在本机 node_modules。

- [ ] 1. 创建构建产物检查测试，不以快照检查样式。检查全部 app.json 路由都有 js/json/wxml/wxss，两个云函数都能在依赖替身下加载 exports.main，客户端包不含 node:crypto、wx-server-sdk 或服务端配置。测试前运行 build，避免把“没有构建”误判为产品行为回归。

```ts
test('导航中的每一页都拥有完整构建文件', async () => {
  const root = resolve('dist/miniprogram');
  const app = JSON.parse(await readFile(join(root,'app.json'),'utf8'));
  assert.equal(app.pages.length,5);
  assert.equal(app.tabBar.list.length,2);
  for (const page of app.pages) {
    for (const extension of ['js','json','wxml','wxss']) {
      await access(join(root,`${page}.${extension}`));
    }
  }
});
```

此测试从 node:test、node:assert/strict、node:fs/promises、node:path 导入相应符号。全量测试脚本先构建，再搜集测试执行；开发时单文件行为测试不要求构建。
- [ ] 2. 写 README：依赖安装、配置示例、构建、微信开发者工具导入 dist、真实 AppID、云环境 ID、fileIdPrefix 的填写位置。AppID 与 envId 写入被忽略的 config/cloud.local.json，由构建脚本生成工具配置；不依赖 project.private.config.json 是否支持覆盖 AppID。服务端 FILE_ID_PREFIX 仅部署到云函数环境变量。缺云配置仍能阅读课程，明确说明哪些操作需要云环境。
- [ ] 3. 写部署步骤：创建 uploads/practices/completions 集合及 Task 6/7 索引 → 应用数据库禁客户端规则和私有存储规则 → 部署 learning/maintenance 并安装依赖 → 配置定时触发 → 用两个测试账号执行权限检查。不能将自动创建收费资源作为 npm install/build 的副作用。
- [ ] 4. 在 docs/acceptance.md 创建逐项验收表，初始状态均为“未执行”，实测后写实际日期、环境、步骤、结果。覆盖：从零开始读首课；未达标练习不解锁；达标打卡解锁；完成前五课时选修与推坡同时可学；选修不影响 10 课进度；重复提交；重新进入恢复；两个账号隔离；播放刷新；删除保留进度；过期清理；相册 180 秒、拍摄 60 秒、100 MB 边界；弱网、取消、临时文件失效、权限拒绝；进阶入口筹备状态。
- [ ] 5. 运行 `npm ci`，随后 `npm run typecheck`、`npm test`、`npm run build`、`git diff --check`。失败先按 systematic-debugging 技能定位，不通过降低权限或跳过验证伪装修复。验证原生页面编译成功不能只靠 esbuild：在微信开发者工具中检查 WXML/WXSS/基础库兼容性，并记录可复现错误和处理结果。
- [ ] 6. 读取项目可用工具，若已安装微信开发者工具则使用其支持的 CLI 或 GUI 导入并验证；不得假称有未安装的工具。AppID/云环境缺失不阻止本地构建、单元测试、页面交付和说明文档完成，只把真实云上传、账号隔离与真机项标为未验证，并明确所缺配置。
- [ ] 7. 内容交付检查：11 课各有真实可读的草稿内容，来源标注正确；不存在空标题、未展示段落或把媒体占位误当成教学完成。未经校对保持 draft，不为通过发布验收批量改成 reviewed。AI 仅保留设计扩展说明，不在界面放不可用的分析按钮。
- [ ] 8. 按 verification-before-completion 技能复核实际命令输出，检查变更范围，只提交本任务文件，提交 `docs: document setup and verified miniapp acceptance`。最终交付说明分别列出已完成功能、本地验证结果、实际执行的开发者工具/真机项和缺少的云配置，不将“未执行”改写为“通过”。

## 平台核对记录与实施边界

本计划编写于 2026-11-06，以下通过官方仓库源码或发布包元数据读取。网页搜索工具未返回可引用正文，因此这里保留可复查的原始地址与具体用途；没有将搜索失败当作已验证证据。

| 官方来源 | 已核对内容 | 对实施的影响 |
|---|---|---|
| `https://raw.githubusercontent.com/wechat-miniprogram/api-typings/master/types/wx/lib.wx.api.d.ts` | ChooseMediaOption 的 maxDuration 注释写拍摄 3–60 秒，相册不受该参数限制 | 拍摄先设 60 秒，相册在返回后执行产品 180 秒限制 |
| `https://raw.githubusercontent.com/wechat-miniprogram/api-typings/master/types/wx/lib.wx.cloud.d.ts` | cloud.uploadFile 有 UploadTask 和 Promise 两种重载 | 用回调形式保留进度和取消能力 |
| `https://raw.githubusercontent.com/wechat-miniprogram/wx-server-sdk/master/index.d.ts` | getWXContext、getTempFileURL、deleteFile、runTransaction 等入口及逐文件状态字段 | 服务端使用官方身份、临时地址和事务接口，不能忽略逐文件错误 |
| `https://docs.cloudbase.net/storage/security-rules` | 所有者规则使用 auth.openid/resource.openid，并展示路径正则条件 | 使用私有读取与所有者写入，在部署环境验证组合规则 |
| npm 包自身元数据 | 固定的 TypeScript/esbuild/tsx/miniprogram-api-typings/wx-server-sdk 版本存在 | 安装时生成并提交 lockfile，构建与类型检查验证兼容性 |

官方主分支类型定义不等于目标基础库已真机验证。尤其文件 Range 响应、实际云文件前缀、触发器事件字段、存储规则和微信开发者工具游客导入行为，必须以部署环境验收为准。若能力与计划不符，记录具体证据并修正适配实现，维持同一产品行为与私有权限，不能以伪造结果替代。

## 规格覆盖检查

| 设计要求 | 实施任务 | 验证位置 |
|---|---|---|
| 11 课、10 必修、选修可跳过 | 1、2 | catalog/progress 测试、路线页面验收 |
| 媒体缺失占位、课程草稿标识 | 1、2、8 | 课程页面验收、内容交付检查 |
| 锁定预览、复习、下一课、阶段完成 | 1、2、5 | progress/learning/practice 测试 |
| 视频上传、进度、取消、产品限制 | 4、5 | media/files/practice 测试、真机边界 |
| 未达标保存、全部勾选完成 | 3、5 | validation/server/practice 测试 |
| 身份、前置、归属、版本、幂等事务 | 3、4 | server/files 测试、双账号验收 |
| 文字草稿、临时路径、账号隔离 | 5 | practice 测试及重新进入验收 |
| 记录列表、筛选、回看、私有播放 | 6 | records/server 测试与云端验收 |
| 删除视频、保留完成、失败补偿 | 6、7 | records/maintenance 测试 |
| 24 小时过期上传清理 | 7 | maintenance 测试、定时任务验收 |
| 无云可阅读、错误不伪装成功 | 2、5、8 | learning/practice 测试和配置说明 |
| 云函数部署、索引、规则、真机检查 | 8 | README、docs/acceptance.md |
| 后续课程与 AI 的边界 | 2、8 | 页面与范围审查 |

## 计划自检与执行交接

- 所有执行任务均有文件、接口、行为验证、实现步骤及提交节点。
- 测试替身仅用于自动化验证；正式数据服务没有自动回落到模拟成功的分支。
- 开发任务没有要求立即公开发布或创建付费云资源。
- 接口别名统一为 checkedIds、result、expectedFileId、sourceRecordId；云 SDK 的 fileID 只在适配器边界转换。
- 用户已批准设计。本计划执行方式按 writing-plans 技能交接，可选逐任务子代理实施并复核，或在当前会话按任务顺序实施；两种方式均使用同一验收标准。
