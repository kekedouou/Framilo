# 当前交接

当前任务：RELEASE-README
任务状态：已完成
产品阶段：首个正式版本的上架前整体审查
维护记录：[正式包说明与干净发布副本](progress/development-history.md#2026-11-08-正式包说明与干净发布副本)
候选提交：e181e96
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权
负责人批准完整README草稿，要求更新独立发布副本、保留许可证、清理本机偏好和空缓存目录，重新打包替换旧ZIP；之后由负责人导出.eagleplugin供检查。基线2b1aeee，工作区干净。本轮仅本地文档/打包脚本/发布副本及必要校验，不继承此前远端推送授权，不安装或运行Eagle插件。

## 方案、步骤与预算
将批准正文保存为docs/releases/framilo-package-readme.md；store-review构建从来源提交读取该模板，代替开发审查ZIP说明，原私人快照配方保留。只从73个运行文件白名单建立新的独立发布目录，避免复制日常目录产生的memory-settings.json、annotation-data或cache（含空目录）；不对任何现有插件数据目录执行清理。

步骤：同步模板/构建入口→既有打包回归与文档检查→本地干净提交→新包逐文件、许可与数据排除核验→替换旧ZIP及摘要→回执/文档与本地提交。dist总预算256MiB，verification-runs/release-readme额外证据≤2MiB，无媒体生成。旧替换对象仅dist/framilo-1.0.0-store-review.1-5858cf1-win-x64.zip及.sha256，原摘要d5e108e1f3f4167e0f30f13861ac6650351a5b2d85703c6130609d01758590b3；新包验证成功后再移除。旧展开目录和G盘导出件保留。

## 完成条件与接续
新[发布副本ZIP](../dist/framilo-1.0.0-store-review.1-e181e96-win-x64.zip)来源e181e96，4518926字节；SHA256为209bcf9033dd84cf8adfac7758b3523f84bde39fbb1a02f8686e4befcd183d18。包内README与[批准模板](releases/framilo-package-readme.md)逐字节一致；73个运行文件及5份许可/来源文件与上一包完全一致，132个依赖包/68份许可文本闭包通过。75个ZIP条目及BUILD-INFO摘要通过，无偏好、圈画、缓存文件或空缓存目录。

旧5858cf1 ZIP及摘要已按原SHA核对后替换，仅删除这两个文件；日常plugin、全部旧展开目录及G盘导出件未动。build/content-check/replacement回执位于verification-runs/release-readme，约3KiB。打包脚本语法、既有打包回归、文档与交接检查通过；正常播放器/原生桥没有变化，不重跑无关媒体或宿主实验。

发布包仍处于上架准备，不表示已获商店批准。等待负责人导出新.eagleplugin后核验；已知问题/真实Build 22安装验证边界见[验收登记](acceptance.md)。

## 前端预览恢复
预览回执：verification-runs/e52/frontend/server.json

本轮无产品界面变化，不启动预览。需要时运行node scripts/frontend-preview.cjs并核对新回执；浏览器不能代替真实Eagle安装验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
