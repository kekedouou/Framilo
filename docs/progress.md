# 当前交接

当前阶段：E-52
候选提交：本次E52窗口适配修订（基线dcd16d3，原生程序沿用529ed38）
候选状态：第二阶段优化及本轮预览反馈已实现；待真实Eagle集中体验，不是发布通过。

## 当前授权与结果
2026-11-01用户批准E52 A/B/C/D并确认关闭原生程序占用，候选已构建替换。未安装依赖、导入素材或写Eagle标注；不启动第三阶段或发布。
- 常用MP4/M4V、MOV、MKV、WebM入口及时间戳/音轨修复；实测组合和色彩限制见[能力表](releases/motionote-capabilities.md)。
- 删除JPEG/额度/能力/操作指引入口，迁移旧偏好；临时媒体按窗口隔离、1 GB确认、正常关闭回收，保护永久/未知/活动数据。
- 已修复重建丢控件；本轮居中格式说明、横竖窗口适配、拉伸去重复计算已实现。模型/浏览器与真实Eagle待验分开记录。
实现/检查/已知限制见[E52报告](experiments/E52/report.md)，范围见[批准计划](experiments/E52/plan.md)。E49冻结503e0a6及原始历史不改。

## 集中体验待验
1. 在真实Eagle打开用户此前失败的MKV，以及常用MP4/MOV/WebM，检查声音、播放/拖动/松手/逐帧/片段/记录；没有用合成浏览器结果代替这些检查。
2. 设置无旧模式/容量/指引；大临时文件确认、拒绝继续原片、生成中退出及再打开重新准备。窗口关闭体感仍需人工判断。
3. 未标色彩的高清参考差异、未支持编码、GPU全组合/全素材/长期稳定性没有通过承诺。第三阶段与发布不自动开始。

## 前端预览恢复
入口：[普通示例](http://127.0.0.1:9506/b905d9449bd00efa4d0c4f08dcbcdd2f90cd/) · [本轮密集标注示例](http://127.0.0.1:9506/b905d9449bd00efa4d0c4f08dcbcdd2f90cd/?scenario=dense)。进程回执verification-runs/e52/frontend/server.json；仅本次服务有效。共享正式UI资源，刷新前保留待发批注/草稿。
服务不在时，由Codex运行`node scripts/frontend-preview.cjs`，读取新回执里的URL，在Codex内置浏览器打开并提供给用户；停止时只终止回执对应且命令行身份相符的本次node服务，不结束其它Node/Eagle进程。
可体验样本播放/菜单/记录/标注/片段/提示/布局，可内置浏览器批注。原生窗控/GPU/磁盘清理/性能禁用；不导入真实视频、不连接Eagle，不证明原生性能/精度/音画。普通与密集示例使用独立sessionStorage；重置前保护草稿。横拖事件已模型验证，实际手感待体验。预览按需，不要求持续电脑控制。
长期机制见[前端预览流程](development-plan.md#前端预览与反馈流程)。

维护记录：[E52交付复核](experiments/E52/report.md)

## 检查与工作区
既有原生/音轨/生命周期结果及本轮UI检查分开记入报告；提交后核对干净状态。没有推送远程、发布或改冻结标签。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务继承差异。E52隔离媒体/缓存≤2 GiB、证据≤64 MiB；实验原始失败与改进结果分开保存，不覆盖历史。

## 历史导航
[清理记录](progress/2026-10-31-probe-cleanup.md) · [语言整理](progress/2026-10-31-document-language.md) · [阶段索引](experiments/README.md) · [前端预览长期登记](progress/2026-11-01-frontend-preview-workflow.md) · [E51报告](experiments/E51/report.md) · [冻结记录](releases/e49-frozen-2026-10-30.md) · [文档职责整理](progress/2026-10-31-document-reorganization.md)
