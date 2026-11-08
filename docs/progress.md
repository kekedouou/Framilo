# 当前交接

当前任务：RELEASE-DOCS
任务状态：进行中
产品阶段：首个正式版本的上架前整体审查
维护记录：[包内说明与审核数据文档](progress/development-history.md#2026-11-08-包内说明与审核数据文档)
候选提交：75f4691
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权

负责人批准三份完整草稿，要求更新包内README、保存审核说明和数据说明、补齐链接，重新打包替换旧版本且dist仅保留最新包，日常插件数据不动。基线166ff35，工作区干净。本轮仅本地文档、独立发布副本及必要核验；不继承上一轮推送授权，不修改运行代码、安装/运行Eagle或G盘导出件，不写素材库。

## 方案、步骤与预算

包内README继续由docs/releases/framilo-package-readme.md提供；审核说明保存为framilo-review-notes.md，完整数据说明保存为framilo-data.md，同处docs/releases。审核说明链接包内模板及数据说明，GitHub根README改链完整数据说明，开发使用导航接入两份材料。只把包内README放入ZIP，其余为仓库/投稿材料，避免重复塞入安装包；保留全部许可证和固定商店UUID。

步骤：保存批准正文/补链接→文档与既有打包回归→本地提交→白名单构建新包→比较前后包（只允许README、BUILD-INFO变化）并检查数据排除/许可→核对旧目录无数据/链接/活动进程后清理→同步实际回执/本地提交。dist总预算256MiB，verification-runs/release-docs证据≤1MiB，不生成媒体。旧替换目标仅dist/framilo-1.0.0-store-review.1-75f4691-win-x64目录、ZIP和.sha256；旧ZIP SHA256为0b459be63aee80c55cf96f9effcce021bb3b5d04818958ae3eb8f9838bfffaeb，待新包通过后才删除。若策略拒绝删除，不绕过，明确交由负责人手动处理。

## 完成条件与接续

完成条件为新包正文、运行文件/许可证/UUID不变、无偏好/圈画/缓存、链接及摘要通过，dist仅余最新目录/ZIP/摘要，日常永久数据核对不变。新包完成后由负责人导出.eagleplugin，再做最终包检查；实际导出、安装和商店审核不能用本地检查替代。

## 前端预览恢复

预览回执：verification-runs/e52/frontend/server.json

本轮无产品界面变化，不启动预览。包/模型检查不能代替真实Eagle验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md)
