# 当前交接

当前阶段：E-53
候选提交：Framilo自用产品化（基线494de89，原生程序沿用529ed38）
候选状态：A流线已选；执行品牌/自用包/基础验收与恢复，长期观察待开展，暂不发行。

## 当前授权与结果
2026-11-01用户选定新A流线F，批准五包连续推进，确认Eagle载入本项目plugin目录。名称Framilo、版本0.2.0-private.1已接入，目标为本人长期自用，不公开发行；既有宿主待验不豁免。
- 常用MP4/M4V、MOV、MKV、WebM入口及时间戳/音轨修复；实测组合和色彩限制见[能力表](releases/motionote-capabilities.md)。
- 删除JPEG/额度/能力/操作指引入口，迁移旧偏好；临时媒体按窗口隔离、1 GB确认、正常关闭回收，保护永久/未知/活动数据。
- 已修复重建丢控件、居中格式说明、窗口适配和拉伸重复计算；本轮标注后空格播放及去焦点框已通过模型/浏览器检查，真实Eagle待验。
后续执行见[E53计划](experiments/E53/plan.md)，本轮结果见[E53报告](experiments/E53/report.md)；第二阶段证据见[E52报告](experiments/E52/report.md)。E49冻结503e0a6不改。

## 集中体验待验
1. 在真实Eagle打开用户此前失败的MKV，以及常用MP4/MOV/WebM，检查声音、播放/拖动/松手/逐帧/片段/记录；没有用合成浏览器结果代替这些检查。
2. 设置无旧模式/容量/指引；大临时文件确认、拒绝继续原片、生成中退出及再打开重新准备。窗口关闭体感仍需人工判断。
3. 未标色彩、未支持编码、GPU全组合/全素材/长稳未通过；按E53分层验证，先自用，不承诺发行日期。

## 前端预览恢复
新入口：[Framilo示例](http://127.0.0.1:13668/40d219298cf82ed62e54bb70a689a29a6d1d/)，可加?scenario=dense。回执verification-runs/e53/preview-server.json；Codex打开请求已排队，未确认用户可见。旧9506服务和草稿未动。共享正式UI资源，刷新前保护批注/草稿。
服务不在时，由Codex运行`node scripts/frontend-preview.cjs`，读取新回执里的URL，在Codex内置浏览器打开并提供给用户；停止时只终止回执对应且命令行身份相符的本次node服务，不结束其它Node/Eagle进程。
可体验样本播放/菜单/记录/标注/片段/提示/布局，可内置浏览器批注。原生窗控/GPU/磁盘清理/性能禁用；不导入真实视频、不连接Eagle，不证明原生性能/精度/音画。普通与密集示例使用独立sessionStorage；重置前保护草稿。横拖事件已模型验证，实际手感待体验。预览按需，不要求持续电脑控制。
长期机制见[前端预览流程](development-plan.md#前端预览与反馈流程)。

维护记录：[E53执行记录](experiments/E53/report.md)

## 检查与工作区
完整默认检查通过；独立原生17组合/85次准确帧和关闭回执通过，未替代Eagle音画/手感。快照构建待代码提交后执行；长期计数见[验收清单](experiments/E53/acceptance.md)。无推送/发布/冻结标签改动。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务继承差异。E53品牌≤8 MiB、证据≤64 MiB、dist快照≤256 MiB；复用自有媒体，不跑长测。E52历史保留。

## 历史导航
[清理记录](progress/2026-10-31-probe-cleanup.md) · [语言整理](progress/2026-10-31-document-language.md) · [阶段索引](experiments/README.md) · [前端预览长期登记](progress/2026-11-01-frontend-preview-workflow.md) · [E51报告](experiments/E51/report.md) · [冻结记录](releases/e49-frozen-2026-10-30.md) · [文档职责整理](progress/2026-10-31-document-reorganization.md)
