# 当前交接

当前任务：RELEASE-DOCS
任务状态：待验收
产品阶段：首个正式版本的上架前整体审查
维护记录：[包内说明与审核数据文档](progress/development-history.md#2026-11-08-包内说明与审核数据文档)
候选提交：d6bbe41
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权

负责人批准三份完整草稿，要求更新包内README、保存审核说明和数据说明、补齐链接，重新打包替换旧版本且dist仅保留最新包，日常插件数据不动。基线166ff35，工作区干净。本轮仅本地文档、独立发布副本及必要核验；不继承上一轮推送授权，不修改运行代码、安装/运行Eagle或G盘导出件，不写素材库。

## 方案、步骤与预算

包内README继续由docs/releases/framilo-package-readme.md提供；审核说明保存为framilo-review-notes.md，完整数据说明保存为framilo-data.md，同处docs/releases。审核说明链接包内模板及数据说明，GitHub根README改链完整数据说明，开发使用导航接入两份材料。只把包内README放入ZIP，其余为仓库/投稿材料，避免重复塞入安装包；保留全部许可证和固定商店UUID。

步骤：保存批准正文/补链接→文档与既有打包回归→本地提交→白名单构建新包→比较前后包（只允许README、BUILD-INFO变化）并检查数据排除/许可→核对旧目录无数据/链接/活动进程后清理→同步实际回执/本地提交。dist总预算256MiB，verification-runs/release-docs证据≤1MiB，不生成媒体。旧替换目标仅dist/framilo-1.0.0-store-review.1-75f4691-win-x64目录、ZIP和.sha256；旧ZIP SHA256为0b459be63aee80c55cf96f9effcce021bb3b5d04818958ae3eb8f9838bfffaeb，待新包通过后才删除。若策略拒绝删除，不绕过，明确交由负责人手动处理。

## 完成条件与接续

文档、链接和新包核验已完成；最新包为dist/framilo-1.0.0-store-review.1-d6bbe41-win-x64.zip，SHA256为2cf02d172efda728bbeab3f605dde92c3029dd6160ad353ebcde7786c2584263。75文件与旧版相比仅README及BUILD-INFO变化，73运行文件、许可证及UUID不变，无偏好/圈画/缓存。日常37个偏好/圈画文件逐项核对不变；G盘导出件未改，仍对应旧75f4691，需负责人重新导出。

未完成项：已核对旧目录内容/摘要、无重解析点及活动运行引用，但工具在执行前以blocked by policy拒绝删除，未绕过。dist目前为新旧两套共6项；负责人须手动删除含75f4691的旧目录、ZIP和.zip.sha256，保留含d6bbe41的新目录、ZIP和摘要。接到删除通知后只读确认仅剩最新三项，再检查负责人重新导出的.eagleplugin；实际导出、安装和商店审核不能用本地检查替代。本轮仅本地提交，未推送。

## 前端预览恢复

预览回执：verification-runs/e52/frontend/server.json

本轮无产品界面变化，不启动预览。包/模型检查不能代替真实Eagle验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
