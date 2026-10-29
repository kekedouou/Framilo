# E44重建前版本留档

2026-10-28，开始写重建计划之前保存。没有Git提交、reset、切分支、改写历史或更改暂存区。

- 当前分支：main。
- HEAD：43b0f418ced6a9359e347aea4fddceb792a6f66a（43b0f41），旧的演示标题修订提交，不代表近期播放器积累。
- 当前源码快照：[source.zip](../../../verification-runs/e44-planning/checkpoint-20261028/source.zip)，679个文件，31,922,449字节。
- ZIP SHA256：a36786832c011e898dcc255b6e2b075ca04461bda27edde8b512af19a3dec510。
- [清单与校验](../../../verification-runs/e44-planning/checkpoint-20261028/manifest.json)记录每个文件内容哈希、分支、HEAD、状态/暂存/差异哈希。ZIP逐文件解包读取校验通过。
- 同目录保存status.z、staged.patch、head-to-worktree.patch。快照包含所有现有Git跟踪/未忽略未跟踪源码，以及本机guard二进制和构建收据。三份旧已暂存探针原样保留。
- 被忽略的素材、缓存、旧实验证据、偏好和标注仍在原处保护，**没有被此源码ZIP备份**；清理前必须另核对。没有复制原视频，也没有创建嵌套Git仓库。

恢复时先对比快照清单与待恢复范围，在隔离目录检验后定点恢复；不得把ZIP整包覆盖当前工作区或使用reset丢弃后续工作。运行还依赖原Eagle/FFmpeg环境，源码可恢复不等于任意机器可直接运行。

本次“记录当前Git版本”以真实HEAD、未提交差异和可恢复源码快照实现；没有把未通过的版本伪装为正式发行。若批准阶段要求改用本地Git里程碑，可另明确覆盖此前不提交的约定。
