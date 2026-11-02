# 当前交接

当前阶段：E-55
候选提交：89830c6（E55运行代码）
候选状态：减重/监测移除及自用包本地检查完成；真实Eagle/长稳待验，不缩兼容。

## 当前授权与结果
用户批准五包自用推进及E55减重/移除监测，明确保留视频兼容；Eagle载入本项目plugin目录。Framilo/A标识、不发行及[能力限制](releases/motionote-capabilities.md)不变。[E55计划](experiments/E55/plan.md)/[结果](experiments/E55/report.md)；E53/E54待验延续，E49冻结不改。
新包：dist/framilo-0.2.0-private.2-89830c6-win-x64.zip，4.30 MiB（减少63.16%），包/许可/CPU-GPU读帧校验通过；旧包保留回退。项目入口关闭重开即用新版，不另装/推送。

## 集中体验待验
1. 在真实Eagle打开用户此前失败的MKV，以及常用MP4/MOV/WebM，检查声音、播放/拖动/松手/逐帧/片段/记录；没有用合成浏览器结果代替这些检查。
2. 设置无旧模式/容量/指引；大临时文件确认、拒绝继续原片、生成中退出及再打开重新准备。窗口关闭体感仍需人工判断。
3. 未标色彩、未支持编码、GPU全组合/全素材/长稳未通过；按E53分层验证，先自用，不承诺发行日期。

## 前端预览恢复
入口：[Framilo示例](http://127.0.0.1:5800/8c201fc539f8a31e3b9e2246c4e5088eac93/)，可加?scenario=dense。回执verification-runs/e55/preview-server.json；ego已验设置/记录，页面保留给用户，服务运行中。共享正式UI资源；刷新前保护批注/草稿。
服务停止后Codex运行`node scripts/frontend-preview.cjs`，依新回执URL打开内置浏览器；停止只处理回执及命令行身份匹配的本次服务，不结束其它进程。
可体验合成样本UI；不连接Eagle/真实素材，禁用原生窗控/GPU/清理，不证明音画/精度/手感。示例隔离草稿，不要求持续电脑控制；旧服务/草稿未清理。
长期机制见[前端预览流程](development-plan.md#前端预览与反馈流程)。

维护记录：[E55执行记录](experiments/E55/report.md)

## 检查与工作区
全量回归、原生17组合255次帧结果一致及三轮计时通过；原生程序29,210,112→9,693,696字节。仅本地证明，真实Eagle音画/手感待验；长期计数见[E53清单](experiments/E53/acceptance.md)。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务差异。E55证据≤128 MiB；复用E52样本，不生成媒体/写库。E44工具累计≤8 GiB、dist≤256 MiB；旧包/媒体/历史证据保留。

## 历史导航
[阶段索引](experiments/README.md) · [文档整理](progress/2026-10-31-document-reorganization.md) · [清理](progress/2026-10-31-probe-cleanup.md) · [预览机制](progress/2026-11-01-frontend-preview-workflow.md)
