# 当前交接

当前任务：STORE-REVIEW-1
任务状态：已完成
产品阶段：首个正式版本的上架前整体审查
维护记录：[1.0.0首轮审查交付](progress/development-history.md#2026-11-04-首个正式版本审查交付)
候选提交：0fa8818
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权
用户明确本次集中验收通过，要求核对文档、清理本轮修复残留、生成压缩包替换旧版，并提交Git和推送既有远端；不创建tag，不公开发行或提交商店。此前暂不提交的限制由本次授权替代。版本定为1.0.0，首轮上架前审查包使用store-review.1标识；不代表已通过整体提交审查或最终以此版本上架。

范围为已验BUGFIX-FOUR源码/回归、版本清单、既有打包脚本和受影响文档；不追加输入法修复或其它功能。运行源码0fa8818已提交并推送main，新包已验证并替换旧包；本次交付回执随文档提交同步远端。dist沿用256MiB预算；本轮收尾证据归verification-runs/bugfix-four，总量仍≤2MiB。仅清理已确认归属且失效的诊断开关和被新包替代的旧交付；历史失败证据、封存实验、用户配置/标注/素材均保护。无依赖安装、媒体生成或素材库写入。

## 验收与接续
用户确认重启电脑后候选框恢复显示，但候选框跨帧残留仍存在，明确暂缓彻底修复。NOTE-02保持“未修复、用户接受本阶段暂缓”；重启恢复不作为代码修复证据，原间歇无法输入的根因和所有场景稳定性仍未确认。此前真实故障及隔离实验有效证据保留，详见[问题登记](acceptance.md)和[调查](progress/development-history.md#note-02-输入同步重新审计)。PLAY-03、NOTE-01、UI-01沿用用户通过结论，不扩展为全设备、全素材或长稳通过。

收尾仅改版本、打包与文档，没有新增可见交互，不再要求重复集中体验。上架前整体提交审查仍待安排；品牌/许可、能力承诺及未覆盖安装升级等按现有路线核对，不能用本次Git推送替代。

## 前端预览恢复
预览回执：verification-runs/e52/frontend/server.json

审查包：[framilo-1.0.0-store-review.1-0fa8818-win-x64.zip](../dist/framilo-1.0.0-store-review.1-0fa8818-win-x64.zip)，来源0fa8818；完整默认检查、运行/许可闭包、ZIP逐文件摘要均通过，回执verification-runs/bugfix-four/review1-package.json。旧ZIP及校验文件已替换；新包展开目录保留供整体审查核验，不是额外安装入口。包不含本轮IME诊断工具/开关、实验、素材、偏好或标注；ZIP不是Eagle导出的.eagleplugin商店安装包。

此前同源预览回执在verification-runs/e52/frontend/server.json，重启后不沿用旧PID或声称地址在线。本轮无新增可见行为，不启动预览；需要时由Codex执行node scripts/frontend-preview.cjs并读取新回执恢复，保护原样本和草稿。已有浏览器合成输入不替代Windows/Eagle输入法验收。正式app诊断接线已撤回，两个失效开关已清理，工具默认关闭；历史实验和失败证据保留，详见维护记录。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md) · [历史工作包](experiments/README.md)
