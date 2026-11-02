# 当前交接

当前阶段：E-56
候选提交：E56本轮源提交（新包BUILD-INFO为准，基线0fdc8c3）
候选状态：细节修订/本地检查完成；private.3自用交付，真实Eagle/长稳待验。

## 当前授权与结果
整轮反馈见[E56计划](experiments/E56/plan.md)/[结果](experiments/E56/report.md)。自用、不发行、不缩兼容、[能力限制](releases/motionote-capabilities.md)不变；Eagle载入项目plugin。E53/E54待验延续，E49冻结不改。
新包为dist/framilo-0.2.0-private.3-<提交短号>-win-x64.zip。实际大小/SHA及旧包清理结果见verification-runs/e56的package-build.json、package-smoke.json、distribution-cleanup回执。只保留最新一组，旧版需按来源重建；项目入口关闭重开即用新版，不另装/推送。

## 集中体验待验
1. 在真实Eagle打开用户此前失败的MKV，以及常用MP4/MOV/WebM，检查声音、播放/拖动/松手/逐帧/片段/记录；没有用合成浏览器结果代替这些检查。
2. 设置无旧模式/容量/指引；大临时文件确认、拒绝继续原片、生成中退出及再打开重新准备。窗口关闭体感仍需人工判断。
3. 未标色彩、未支持编码、GPU全组合/全素材/长稳未通过；按E53分层验证，先自用，不承诺发行日期。

## 前端预览恢复
入口：[更新后检查页](http://127.0.0.1:5800/8c201fc539f8a31e3b9e2246c4e5088eac93/?scenario=e56)。回执verification-runs/e55/preview-server.json；内置浏览器已验记录/编辑/默认工具条、B/O和短说明，保留新版页；原批注/草稿页不动。服务运行中，共享正式UI资源。
服务停止后Codex运行`node scripts/frontend-preview.cjs`，依新回执URL打开内置浏览器；停止只处理回执及命令行身份匹配的本次服务，不结束其它进程。
可体验合成样本UI；不连接Eagle/真实素材，禁用原生窗控/GPU/清理，不证明音画/精度/手感。示例隔离草稿，不要求持续电脑控制；旧服务/草稿未清理。
长期机制见[前端预览流程](development-plan.md#前端预览与反馈流程)。

维护记录：[E56执行记录](experiments/E56/report.md)

## 检查与工作区
E56全量回归及72文件/许可闭包通过；最近帧、迟到请求、循环边界、快捷键/偏好和动效生命周期已测。原生程序沿用E55，不重跑解码速度测试。真实Eagle音画/手感待验；长期计数见[E53清单](experiments/E53/acceptance.md)。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务差异。E56证据≤16 MiB；复用样本/服务，不生成媒体/写库。旧包/媒体/历史证据保留。

## 历史导航
[阶段索引](experiments/README.md) · [文档整理](progress/2026-10-31-document-reorganization.md) · [清理](progress/2026-10-31-probe-cleanup.md) · [预览机制](progress/2026-11-01-frontend-preview-workflow.md)
