# 当前交接

当前任务：STORE-UUID
任务状态：待验收
产品阶段：首个正式版本的上架前整体审查
维护记录：[正式投稿UUID修复](progress/development-history.md#2026-11-08-正式投稿uuid修复)
候选提交：75f4691
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权

负责人报告投稿页面拒绝非UUID插件ID，要求解决后准备审核/数据说明问卷，确认前不写正式稿。基线5e47548，工作区干净。本轮仅修复打包身份/校验、构建独立干净发布副本、同步文档；日常plugin及数据不改，不安装、卸载、迁移数据、推送或投稿，不改写G盘已导出的.eagleplugin。

## 方案、步骤与预算

store-review使用固定UUID `65709e49-3320-4c75-8925-526e55dd0ecb`；日常plugin/私人快照保留旧ID，两种身份不可混用。商店以后更新保持此UUID；首个商店包不自动接管开发入口圈画/偏好，不得为此清理旧数据。不是播放器重构。

步骤已完成：复现旧ID被本地校验误接收→固定商店身份并校验manifest/BUILD-INFO一致→专项打包/许可/文档回归→本地提交→构建干净ZIP→逐文件差异核对。dist总预算256MiB，verification-runs/store-uuid证据≤1MiB，实际约2KiB，无媒体/宿主实验。旧ZIP、展开目录和G盘导出件均保留为问题证据。

## 完成条件与接续

本地修复/回归/打包完成；仍待负责人从[新的干净发布目录](../dist/framilo-1.0.0-store-review.1-75f4691-win-x64/manifest.json)载入并通过Eagle正常导出，再确认上传和安装结果。不能上传旧.eagleplugin，也不能把ZIP改扩展名代替官方导出。

[发布ZIP](../dist/framilo-1.0.0-store-review.1-75f4691-win-x64.zip)来源75f46912cf1c3a726de516b4c4553241354ee01d，4518926字节；SHA256 `0b459be63aee80c55cf96f9effcce021bb3b5d04818958ae3eb8f9838bfffaeb`。与旧e181e96包比较：75文件无增删，仅manifest身份/格式与BUILD-INFO来源/摘要变化；其余73文件（含README、播放器、原生二进制和5份许可/来源文件）逐字节相同。无偏好、圈画、缓存文件或空目录；CRC、74项BUILD-INFO文件摘要、132依赖包/68许可文本闭包通过。回执为verification-runs/store-uuid/build.json与content-check.json。

新增UUID/身份隔离回归及既有private-package、26项native-experience-package、19项release-package通过；脚本语法、文档/交接和差异检查通过。未重新执行无关媒体回归，没有真实Eagle导出/安装或商店成功证据。NOTE-02及真实Build22边界不变，见[验收登记](acceptance.md)。

负责人确认问卷后才撰写审核/数据说明。官方没有统一要求两份同名独立文件；投稿说明/包内README承载审核所需信息，公开商店介绍须说明影响用户的重要数据行为。现有正式README保持原稿。

## 前端预览恢复

预览回执：verification-runs/e52/frontend/server.json

本轮无产品界面变化，不启动预览。包/模型检查不能代替真实Eagle验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
