# 单板滑雪学习小程序

原生微信小程序开发预览：11 门入门课程（10 门必修、1 门选修）、视频练习与自评完成、私人练习记录。课程文字目前均为待教练校对的 `draft`，教学媒体尚未提供；不能将此预览视为已审核的公开教学内容。

## 本地构建

本地使用 Node.js 和 npm。此项目已在 Node.js 21.7.3、npm 10.5.0 上执行构建与测试；云函数打包目标为 Node 18 语法，部署时仍须选择平台实际提供且兼容的运行时。

```sh
npm ci
npm run typecheck
npm test
npm run build
```

`npm test` 先重新构建，再运行全部测试。`dist/` 是生成目录，不提交到 Git。无云配置时构建使用 `touristappid` 和空环境 ID，仍可在开发预览中阅读课程；读取真实进度、上传视频、自评提交、记录和播放均需要云环境，不会模拟成功。

## 小程序配置与导入

在被 Git 忽略的 `config/cloud.local.json` 填写真实小程序 AppID 和云环境 ID：

```json
{
  "appId": "wx-your-real-app-id",
  "envId": "your-cloud-environment-id"
}
```

格式参见 `config/cloud.example.json`。重新执行 `npm run build` 后，构建脚本将 AppID 写入 `dist/project.config.json`，将环境 ID 编入客户端。不要依赖 `project.private.config.json` 覆盖 AppID；也不要把密钥放入这个客户端配置。微信开发者工具应导入整个 `dist/`，其 `project.config.json` 指定 `miniprogramRoot: "miniprogram/"`、`cloudfunctionRoot: "cloudfunctions/"`。导入后检查五个页面的 WXML/WXSS 与目标基础库兼容性，再用真机检查媒体能力。

`FILE_ID_PREFIX` 只在 **learning 云函数的环境变量**中配置，值为对应云环境的真实文件前缀，例如 `cloud://your-cloud-environment-id.your-bucket-id`。它不能从本地 `fileIdPrefix` 字段带入；服务端要求其环境 ID 与 `getWXContext().ENV` 一致。若缺失或不匹配，上传会话会显式失败。不要把此变量编进客户端包。

## 云端部署顺序

以下操作需要有权限的管理员在微信开发者工具和对应云开发控制台执行；`npm ci`、测试和构建不会创建云资源。选用**传统文档数据库与云存储模式**，记录实际环境、运行时和规则验证结果到 [验收表](docs/acceptance.md)。

1. 在同一云环境创建 `uploads`、`practices`、`completions` 集合。按 `config/database.indexes.json` 为各集合创建索引：`practices` 的 `owner_active_recent`、`owner_lesson_active_recent`、`deleting_cleanup`，`completions` 的 `owner_recent`，`uploads` 的 `issued_expiry`。逐项核对字段顺序与升降序；含 `_id` 的复合索引是否被目标控制台接受尚未验证，若拒绝先记录实际错误并验证等效查询/排序方案。
2. 在控制台将三个业务集合的客户端读写都设为禁止，参考 `config/database.rules.json`；将存储规则设为私有读取、所有者可写且限制 `practice/` 路径，参考 `config/storage.rules.json`。这些 JSON 是部署指导，尚未在目标控制台验证。须实际测试拥有者与非拥有者的访问结果，也须确认生成的云文件拥有者和路径符合规则。
3. 在 `dist/cloudfunctions/learning` 和 `dist/cloudfunctions/maintenance` **分别**上传并部署，选择“云端安装依赖”或等效的逐函数依赖安装方式。每个目录自带 `package.json`，不能假定云端能看到仓库根目录的 `node_modules`。为 `learning` 配置上述 `FILE_ID_PREFIX`；记录云函数实际 Node 运行时。
4. `maintenance/config.json` 已由 `config/maintenance.trigger.json` 复制生成，声明每小时一次的 `cleanup-expired` 定时触发器。部署函数后还须在开发者工具执行独立的 **Upload Trigger / 上传触发器** 操作并核对控制台状态。定时入口要求平台提供 `TRIGGER_SRC=timer`、事件 `Type=Timer` / `TriggerName=cleanup-expired`，且没有用户 `OPENID`；不要手动设置 `TRIGGER_SRC` 来伪造信任，也不要仅发送同形事件作为验证。目标环境的真实事件字段仍待观测。
5. 使用两个真实测试账号按验收表检查课程解锁、记录所有权、云存储拒绝、上传/播放/删除、过期清理。检查函数日志中清理的 `removed`、`failed`、`skipped` 计数。每轮最多处理 100 项；若最早的失败条目长期占满候选窗口，后续条目可能得不到处理，须监控积压并排查失败原因。

提交前，`learning` 使用显式固定的 `@cloudbase/node-sdk@3.17.2` 检查文件权限：当前 SDK 用户的 `openId` 必须与可信微信调用者相同，再对会话的精确 `cloudPath` 请求 `getFileAuthority` 的 `READ` 权限。只有返回同一路径且 `read === true` 才继续检查文件和提交。此证明依赖存储读取规则始终为 `resource.openid == auth.openid`，不能改成公开读取；`practice/` 前缀本身不证明文件归属。缺失上下文、权限结果缺失/拒绝/路径不符或接口错误都会拒绝提交。部署时必须验证两个 SDK 的真实用户上下文与精确路径返回格式，以及 B 在 A 已分配但未占用的路径创建视频后，A 的提交仍被拒绝；本地 SDK 传输替身测试不等于这些云端检查已经通过。

当前固定的 `wx-server-sdk@4.0.2` 安装树经 `npm ci` 报告 6 项依赖告警（1 moderate、5 high，含 axios 与 lodash 子依赖）。没有经过 SDK 级兼容验证的依赖覆盖未应用；正式部署前需要评估并验证安全更新，同时让两份生成的云函数依赖清单保持一致。`npm audit fix --force` 所建议的 SDK 降级不是已验证的解决办法。

平台资料：CloudBase [存储安全规则](https://docs.cloudbase.net/storage/security-rules)、[定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)、[云函数环境变量](https://docs.cloudbase.net/cloud-function/function-configuration/env)、[数据索引](https://docs.cloudbase.net/database/data-index)。这些资料用于指导控制台配置；本仓库的本地构建和测试不代替实际控制台、基础库和真机验收。
