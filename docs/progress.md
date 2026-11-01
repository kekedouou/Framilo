# 当前交接

当前阶段：E-52
候选提交：本轮本地提交（提交号见Git；基线0a09d3e）
候选状态：第二阶段优化已实现并进行本地验证；待真实Eagle集中体验，不是发布通过。

## 当前授权与结果
2026-11-01用户批准E52 A/B/C/D整包；实施中用户确认关闭占用原生程序的播放器，新程序已构建替换。没有安装依赖、导入素材或写Eagle标注；不启动第三阶段或发布。
- 常用格式入口收敛MP4/M4V、MOV、MKV、WebM；MKV/WebM实际PTS与音轨缺流级时长处理。具体编码、带声/无声、非零起点、VFR/UHD/HFR证据和色彩限制见[能力表](releases/motionote-capabilities.md)，不是全格式承诺。
- 删除日常JPEG、代理磁盘额度、能力说明、首次/重看/旧操作提示面板；旧偏好迁移，保留数据保护和必要状态。
- 按窗口临时媒体、累计1 GB确认、实际超额回收后确认重启、多窗口物理预留、正常关闭清理；旧缓存迁移在首次正常关闭执行，未知/活动数据保护。
- 正式HTML/CSS/UI/Session同源的开发预览已开放，示例写入隔离sessionStorage；无需用户启动终端。
实现/检查/已知限制见[E52报告](experiments/E52/report.md)，范围见[批准计划](experiments/E52/plan.md)。E49冻结503e0a6及原始历史不改。

## 集中体验待验
1. 在真实Eagle打开用户此前失败的MKV，以及常用MP4/MOV/WebM，检查声音、播放/拖动/松手/逐帧/片段/记录；没有用合成浏览器结果代替这些检查。
2. 设置无旧模式/容量/指引；大临时文件确认、拒绝继续原片、生成中退出及再打开重新准备。窗口关闭体感仍需人工判断。
3. 未标色彩的高清参考差异、未支持编码、GPU全组合/全素材/长期稳定性没有通过承诺。第三阶段与发布不自动开始。

## 前端预览恢复
入口：[当前本机预览](http://127.0.0.1:9506/b905d9449bd00efa4d0c4f08dcbcdd2f90cd/)。进程回执位于verification-runs/e52/frontend/server.json；该地址仅本次服务运行有效，不提交本机回执。共享正式UI更新后刷新可看到新代码，刷新前保留用户待发批注/草稿。
服务不在时，由Codex运行`node scripts/frontend-preview.cjs`，读取新回执里的URL，在Codex内置浏览器打开并提供给用户；停止时只终止回执对应且命令行身份相符的本次node服务，不结束其它Node/Eagle进程。
可体验：样本播放、菜单、记录、文字/圈画、片段、提示和布局；可直接用内置浏览器批注反馈。原生窗控、GPU、磁盘清理和性能入口禁用；不支持拖入真实视频、不连接Eagle，不用于源帧精度/音画/GPU/代理性能验收。示例保存在该标签sessionStorage；重置按钮仅影响示例，未保存草稿先确认。预览服务按需，不要求持续电脑控制。
长期机制见[前端预览流程](development-plan.md#前端预览与反馈流程)。

## 检查与工作区
本地模型回归、原生合成媒体、关闭完整/取消生成、浏览器DOM及音轨检查已分别记录。最终提交前完成默认检查、包闭包、文档/交接/diff检查；提交后require-clean核对。没有推送远程、发布或改冻结标签。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务继承差异。E52隔离媒体/缓存≤2 GiB、证据≤64 MiB；实验原始失败与改进结果分开保存，不覆盖历史。

## 历史导航
[清理记录](progress/2026-10-31-probe-cleanup.md) · [语言整理](progress/2026-10-31-document-language.md) · [阶段索引](experiments/README.md) · [前端预览长期登记](progress/2026-11-01-frontend-preview-workflow.md) · [E51报告](experiments/E51/report.md) · [冻结记录](releases/e49-frozen-2026-10-30.md) · [文档职责整理](progress/2026-10-31-document-reorganization.md)
