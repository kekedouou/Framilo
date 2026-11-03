# 当前交接

当前阶段：E-60
维护记录：[E60根因排查与收尾](experiments/E60/report.md)
候选提交：f6d257c（private.9）；播放器/窗控实现仍为aec97ce的private.8。ZIP为dist/framilo-0.2.0-private.9-f6d257c-win-x64.zip，精确来源及摘要见verification-runs/e60/final-review-package-build.json。
候选状态：FFmpeg声明、完整本地回归、运行/许可闭包及ZIP核验完成，交付集中体验。用户已反馈拖动和黑屏改善；旧包删除被自动策略拦截，新包可用但旧包替换清理未完成。[计划](experiments/E60/plan.md)/[报告](experiments/E60/report.md)。

## 当前授权与结果
用户已确认E58第一项体验完成，E59后续问题单独修复。最新明确认为目前拖动和黑屏已解决，批准最后排查、依赖声明和文档同步，不从零重做、不反复要求测试。
取消固定14天/次数/小时门槛；本轮完成后准备上架资料，未授权实际发布/推送或独立版开发。按用户要求停止宿主自动化；无新增软件安装、素材库/原片/标注写入。

## 验证与待验
实际旧事件确认：清理期间Eagle重显旧窗口，空黑遮罩等待历史缓存维护。private.8跳过仅剩成对回执的旧维护；必要释放仍等待，显示持续说明、保留最新打开请求、明确关闭可取消，失败可重试。
新读到5份private.8指纹匹配的已有Eagle记录：就绪0.748–0.847秒、关闭68.5–104.5ms、旧维护预检4.4–4.8ms。没有交叠重开事件，不等于物理呈现或全部设备通过；与用户体验反馈分开登记。摘要final-review-existing-host.json及原始证据见报告。
最后回归覆盖拖动取消/坐标、重开选择、关闭失败/重试、界面重建、标注保护和FFmpeg缺失处理。真实音画/格式、外部安装升级与历史GPU因果不因本轮自动通过；沿用已有证据，不重置已验项。[验收登记](experiments/E53/acceptance.md)/[能力限制](releases/motionote-capabilities.md)。

## 前端预览恢复
本轮无UI改动，不新建或刷新预览。既有E60等待/取消演示由node scripts/frontend-preview.cjs恢复，回执verification-runs/e60/preview-server.json；不凭旧PID/端口声称仍可用。保护旧服务/草稿，合成UI不验证原生窗口、多屏或真实音画。[长期流程](development-plan.md#前端预览与反馈流程)。

## 工作区
本轮基线88fe35c干净，无其它任务差异；[保留清单](workspace-exceptions.json)。输出限E60既有预算，保护证据/用户数据。startup-audit.local.json的24小时/10份/64KiB/160事件预算不扩展，已达10份，后续操作不保证留新记录；默认包不含配置。新授权下旧包清理仍在执行前被自动审批拒绝（blocked by policy），未绕过；private.7/.8与新包暂存，身份/例外见final-review-old-package-identities.json和final-review-distribution-cleanup.json。

[阶段索引](experiments/README.md)
