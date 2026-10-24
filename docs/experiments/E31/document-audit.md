# E-31 文档与Git核查

## 核查结果

入场Git根正确，HEAD为a1e73af（2026-10-22），192文件未提交，约32.24MB，包含已批准UI设计和E19～E30正式迭代。没有丢失仓库或历史。入场文件清单/hash保存在verification-runs/e31-settings/incoming.json。先修9处新增文件空白行后，真实补录为7f4b544；没有制造不存在的旧提交。冻结发行和本机素材/缓存不入提交。

| 文件 | 查到的遗漏/本轮修正 |
| --- | --- |
| README | 当前E31交接；冻结Beta功能说明继续明确为历史发行 |
| project-profile | 阶段导航E29和模块表过时；补graphite/settings/timeline/window-drag职责与收尾命令 |
| progress | E22～E30缺集中入口；增加阶段/报告索引及本地提交状态 |
| development-plan | 旧“当前任务E18”与未来才做UI容易误导；历史标题化，补本轮与宿主待验边界 |
| roadmap | 顶部停在E14，仍说整体UI未启动；改为UI已经正式迭代、导出入口已撤下、RAM在高级 |
| product | 增E31替代条款：去设置标题、父项锚定；保留R/P和旧行为历史，不把旧独立居中当现行 |
| architecture | 顶层标题仍停阶段3B；补现行模块边界、CSS覆盖原因和锚定机制 |
| verification | E31浏览器/模型协议与真实宿主区别；默认检查纳入当前阶段一致性 |
| CHANGELOG | 本轮UI修正与历史Git补录，冻结版本条目不改 |
| AGENTS | 固化文档影响审查、本地提交、提交后工作区检查和应用UI异常边界 |
| UI01～UI05/E19～E30报告 | 历史决定、失败及证据保留，不改为本轮结果；阶段完整性已核对 |
| releases、旧PoC报告、演示发行说明 | 当前改动未重建或发布软件，保留原验收/下载边界，不为更新率改写 |

## 变更入口调查

Git可正常读取/提交，排除“没有Git仓库或历史丢失”。本机Codex持久状态的已保存项目不含正式仓库，active-workspace-roots为空；这只是持久快照，不证明当前界面绑定。list_projects、list_artifacts、open_in_codex(review)均返回Invalid app tool request，无法自动完成绑定/审查页验证。没有修改应用数据库或重启中断用户工作。

官方说明审查面板要求项目位于Git仓库内，反映整个仓库的更改；Unstaged/Staged/Commit/Branch/Last turn显示范围不同。见[官方审查说明](https://learn.chatgpt.com/docs/code-review?surface=app)。因此应在Codex把真正的eagle-video-analysis文件夹作为项目打开；补提交后未暂存为空属正常，应查看Commit或Branch。界面按钮是否恢复仍需用户确认，不据此宣称彻底修复应用。

## 防止重演

默认检查只能机械核对当前阶段入口与链接，无法证明正文语义正确；本表记录人工逐项审查。提交前check-handoff --base HEAD要求代码变化伴随本阶段报告/进度，提交后--require-clean检查残留。未来若有用户未提交工作，登记归属并保留，不为干净状态擅自提交或丢弃。
