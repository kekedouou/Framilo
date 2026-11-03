# 当前交接

当前阶段：E-60
维护记录：[E60根因排查](experiments/E60/report.md)
候选提交：private.8修复源码待本轮提交；精确来源见verification-runs/e60/reopen-package-build.json及包内BUILD-INFO
候选状态：E60快速重开修复及本地回归已完成，待本轮打包；真实Eagle改善及拖动/GPU问题未验，上架准备暂停。[计划](experiments/E60/plan.md)/[报告](experiments/E60/report.md)。

## 当前授权与结果
用户确认E58第一项集中体验完成；新增异常不被这一确认覆盖。批准兼容/数据安全验证与全屏恢复卡顿、跨屏顶栏拖动失效、关闭失败和反复关闭重开变慢的集中修复。[E59计划](experiments/E59/plan.md)/[结果](experiments/E59/report.md)。每次关闭插件后再打开，截图时Unreal正好崩溃；因果尚未确定。
取消固定14天/次数/小时观察门槛；本轮完成后查询官方发布文档，准备上架资料，未授权实际提交/发布/推送或独立版开发。

## 验证与待验
两份真实startup-host轨迹指纹匹配private.7；首次就绪1.36/0.80秒。21:46:36重开旧窗口，21:46:56.976才重新初始化；当前会话清理到旧缓存释放锁的调用间隔22.625秒。实际应用/UI模型确认：关闭时空白黑遮罩被Eagle重开暴露，新UI等待旧缓存维护。1438组历史清理记录的只读校验耗时2.88秒，未细分全部延迟；证据见报告及reopen-correlation.json。21:47:10 NVIDIA153未建立因果。
修复跳过仅含成对历史回执的旧维护，当前目录只读预检7.52ms；必要释放仍等待并显示持续说明，最新请求自动重开、关闭可取消。已补失败重试和关闭分阶段记录；模型/预览不冒充Eagle通过。[验收登记](experiments/E53/acceptance.md)/[能力限制](releases/motionote-capabilities.md)。
限时startup-audit.local.json写verification-runs/e60/startup-host-*.jsonl，24小时/10份/每份64KiB/160事件；不打包、不含视频标注、不上传。按用户要求停止宿主自动化，不要求固定次数体验；保留旧证据。

## 前端预览恢复
E60等待/取消重开预览已打开： http://127.0.0.1:5852/14ad3038c5a52fd11ad8b9f5a02d396cbbae/?scenario=e60-reopen 。回执verification-runs/e60/preview-server.json，进程23104。旧E59服务/草稿保留。恢复命令node scripts/frontend-preview.cjs；只停止身份匹配服务。合成UI不验证原生窗口、多屏/GPU/音画。[长期流程](development-plan.md#前端预览与反馈流程)。

## 工作区
本轮基线4af2197干净，无其它任务差异；[当前保留清单](workspace-exceptions.json)。输出限E60计划目录；保护限时诊断配置/原始证据，历史数据和E49冻结不变。E60结束后核对身份再移除本轮开启配置，保留证据；不能因Git忽略直接删除。

[阶段索引](experiments/README.md)
