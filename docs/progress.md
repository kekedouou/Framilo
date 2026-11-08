# 当前交接

当前任务：RELEASE-CONSOLIDATE
任务状态：已完成
产品阶段：首个正式版本的上架前整体审查
维护记录：[合并包内说明与私人数据备份](progress/development-history.md#2026-11-08-合并包内说明与私人数据备份)
候选提交：581bca6
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权

负责人要求将审核与数据说明并入包内README，删除重复正文、修正链接，重打包且仅保留最新发布产物，并授权本地提交和远端普通推送。基线005413c，工作区干净，不修改运行代码、不安装或运行Eagle、不写素材库。负责人进一步明确：实际个人数据备份并核验后从项目plugin移除；已确认退出Eagle，执行前仍需核对进程。个人数据与备份不进入Git或远端。

## 方案、步骤与预算

以docs/releases/framilo-package-readme.md为唯一包内正文源，完整包含验证、许可及数据规则；根README链接数据章节，删除两份重复说明。先验证文档、提交干净来源、构建并比较新旧包，运行文件/许可/UUID必须不变。dist预算256MiB，新包核验后清理旧纯发布目录、ZIP及摘要；已拒绝目标不绕过策略，受限如实交由负责人处理。

私人备份在负责人指定的G盘文件夹独立保存，包含plugin中的annotation-data、memory-settings.json、cache、export-work和performance-reports，保留未知条目及目录结构；预计16MiB，含校验清单及恢复说明，总预算64MiB。逐文件核对ZIP解压读取结果与原始数据后，仅删除已核验的精确数据目标；任何变化/链接/活动写入立即停止。Eagle文字标注和原视频属于素材库，不在插件备份内也不删除。恢复只还原圈画/偏好，不回填缓存/临时报告；原素材库路径与素材身份需保持。证据verification-runs/release-consolidate≤2MiB，不保存私人正文至受Git跟踪的文档。

私人备份已完成：2960文件、15633299字节源数据，压缩后4575806字节，ZIP摘要77fe92966e917bcadab331750b21677e1c5c2ccb28349d033804e9a6714e6c91；核验记录仅保存在忽略目录verification-runs/release-consolidate。Eagle进程已退出，复制前后快照及解压字节校验一致。精确个人数据删除命令在执行前被工具以blocked by policy拒绝，未执行；负责人随后确认清理完成；复核个人文件已全部移除，仅cache/export-work空目录保留，无个人数据。

## 完成条件与接续

最新交付为dist/framilo-1.0.0-store-review.1-581bca6-win-x64.zip，4519440字节，SHA256为5cea22b5b006f760591bb8c8e2a2dafa11d121612058fea1d5e17bf96883a348。合并正文在包内独立可读，75文件对比旧版仅README和BUILD-INFO变化，73运行文件/许可/UUID不变，无个人数据；文档检查、private-package回归和构建verify通过。普通快进推送已完成，远端由166ff35更新至581bca66669e720b761a00b12649cf3c65cc1ff6并核对一致，个人文件及备份均未跟踪/推送。

负责人手动清理个人数据及旧发布产物后均已复核。个人文件已移除，仅cache/export-work空目录保留；私人备份2960文件的完整校验记录保留。本次dist精确剩余581bca6展开目录、ZIP及.sha256三个项目，旧75f4691/d6bbe41六项均不存在，最新包verify及原摘要通过。清理由负责人执行，本轮只读核验并更新记录，没有重新打包或改动程序/私人备份。

本轮文档合并、打包、备份和清理工作完成。下一步由负责人从581bca6干净副本导出.eagleplugin，再进行独立的最终导出包检查；本轮完成不代表实际安装或商店审核通过。

## 前端预览恢复

预览回执：verification-runs/e52/frontend/server.json

本轮纯文档/打包/备份，不启动预览；本地归档检查不代表实际Eagle安装验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
