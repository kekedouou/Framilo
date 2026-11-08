# 当前交接

当前任务：DIST-CLEANUP
任务状态：已完成
产品阶段：首个正式版本的上架前整体审查
维护记录：[旧发布产物清理核验](progress/development-history.md#2026-11-08-旧发布产物清理核验)
候选提交：75f4691
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权

负责人要求dist只保留最新发布版本，批准删除已核对旧产物；工具策略拦截删除后，负责人手动删除并确认完成，按约定同步项目文档。基线f9b8607，工作区干净。本轮只读核验包及目录并同步清理记录/保留规则；不改运行代码、包内README、公开说明正文或安装包，不重新打包、安装、迁移数据、推送或投稿。

## 方案、步骤与预算

store-review使用固定UUID `65709e49-3320-4c75-8925-526e55dd0ecb`；日常plugin/私人快照保留旧ID，两种身份不可混用。商店以后更新保持此UUID；首个商店包不自动接管开发入口圈画/偏好，不得为此清理旧数据。不是播放器重构。

步骤：核验dist清单→验证最新目录/ZIP/摘要与许可→只读比对G盘导出包→同步当前入口、保留规则及历史清理记录→文档/交接检查及本地提交。沿用dist总预算256MiB，本轮不新增打包、媒体或证据文件。dist现仅保留75f4691的展开目录、ZIP及.sha256；旧产物已由负责人删除，历史提交/摘要/检查记录保留作追溯，不能再将旧包路径作为使用入口。

## 完成条件与接续

旧产物清理及最新文件完整性核验完成。[唯一发布目录](../dist/framilo-1.0.0-store-review.1-75f4691-win-x64/manifest.json)和下方ZIP是当前交付入口。G盘Framilo.eagleplugin现已使用正式UUID，全部75文件与此ZIP一致，SHA256为aefde32474003093e3d7a1a83969d669a6b23aafbfdabd4fe42cdcf2780948c2；目录条目仅bin/native，无偏好/圈画/缓存。此为导出包只读核验，上传结果及实际安装运行仍待确认，不能把ZIP改扩展名代替官方导出。

[发布ZIP](../dist/framilo-1.0.0-store-review.1-75f4691-win-x64.zip)来源75f46912cf1c3a726de516b4c4553241354ee01d，4518926字节；SHA256 `0b459be63aee80c55cf96f9effcce021bb3b5d04818958ae3eb8f9838bfffaeb`。与旧e181e96包比较：75文件无增删，仅manifest身份/格式与BUILD-INFO来源/摘要变化；其余73文件（含README、播放器、原生二进制和5份许可/来源文件）逐字节相同。无偏好、圈画、缓存文件或空目录；CRC、74项BUILD-INFO文件摘要、132依赖包/68许可文本闭包通过。回执为verification-runs/store-uuid/build.json与content-check.json。

UUID修复时的身份隔离、private-package、26项native-experience-package和19项release-package回归继续有效；本轮只复验包完整性/许可闭包和文档，不重跑无关媒体测试。没有新增真实安装或商店成功证据。NOTE-02及真实Build22边界不变，见[验收登记](acceptance.md)。

负责人已确认问卷并审阅初稿，认可文档职责调整方案，要求先清理旧发布产物；本轮不展开正文整理。后续按商店介绍、GitHub入口、包内离线说明、审核补充及完整数据说明分工减少重复，补充RTX3060/10分钟以内2K视频的个人体验边界（2K是源分辨率还是画质档仍需明确）。现有包内README保持原稿，不因文档整理自动重打包。

## 前端预览恢复

预览回执：verification-runs/e52/frontend/server.json

本轮无产品界面变化，不启动预览。包/模型检查不能代替真实Eagle验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
