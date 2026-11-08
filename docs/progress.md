# 当前交接

当前任务：README-RELEASE
任务状态：进行中
产品阶段：首个正式版本的上架前整体审查
维护记录：[正式版GitHub说明与远端同步](progress/development-history.md#2026-11-08-正式版github说明与远端同步)
候选提交：75f4691
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权

负责人批准GitHub README优化方案，明确最低Eagle 4.0 Build 22，并要求更新为首个正式版本的长期说明，不写“尚未上架”等过渡措辞；授权将当前仓库提交到origin/main。本轮基线89553ef，工作区干净。只更新根README及必要交接/历程，不修改包内README、运行代码或已导出插件，不打包、不发tag/Release、不代为投稿。

## 方案、步骤与预算

保留完整功能介绍，补全正式安装、快捷键/轮盘、性能限制及数据提醒；开发用法从公开入门流程撤下，反馈只留一句GitHub Issues。3060个人体验仅放GitHub，原视频与插件画质均为2K，不进入已定稿商店说明。文案保留真实限制，不将正式版说明措辞当成商店审核证据。

步骤：核对远端及待推送范围→更新README→核对链接/文案/受影响打包回归→文档检查/本地提交→正常快进推送main并核对远端SHA。远端起点2b1aeee，已fetch确认无分叉，本地领先5提交；本轮没有新增媒体、安装包或证据文件。沿用dist只保留最新已核验发布版的规则，忽略的用户数据及ZIP不提交。

## 完成条件与接续

完成条件为README内容/链接校对、文档及受影响检查通过、本地提交与远端main一致。当前仍在执行，不以计划代替推送成功。

唯一候选仍为[75f4691发布ZIP](../dist/framilo-1.0.0-store-review.1-75f4691-win-x64.zip)，其来源、摘要和G盘.eagleplugin核验见[清理记录](progress/development-history.md#2026-11-08-旧发布产物清理核验)。本轮不改变包内容。真实安装运行及商店审核结果未新增证据，见[验收登记](acceptance.md)。

商店说明已在对话中定稿；其余包内README、审核补充及完整数据说明后续单独收尾。当前根README的数据细则链接复用已有产品规范，不创建尚未核对的新链接。

## 前端预览恢复

预览回执：verification-runs/e52/frontend/server.json

本轮无产品界面变化，不启动预览。包/模型检查不能代替真实Eagle验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
