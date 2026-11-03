# 当前交接

当前阶段：E-60
维护记录：[E60根因排查](experiments/E60/report.md)
候选提交：本轮private.7诊断源码；精确来源见verification-runs/e60/package-build.json和包内BUILD-INFO
候选状态：E59实际体验未通过；E60已完成首轮根因排查和有限保护/诊断，本地检查通过，整窗黑屏及拖动错误完整根因仍未确认，暂停上架准备。见[E60计划](experiments/E60/plan.md)/[报告](experiments/E60/report.md)。

## 当前授权与结果
用户确认E58第一项集中体验完成；新增异常不被这一确认覆盖。批准兼容/数据安全验证与全屏恢复卡顿、跨屏顶栏拖动失效、关闭失败和反复关闭重开变慢的集中修复。[E59计划](experiments/E59/plan.md)/[结果](experiments/E59/report.md)。每次关闭插件后再打开，截图时Unreal正好崩溃；因果尚未确定。
取消固定14天/次数/小时观察门槛；本轮完成后查询官方发布文档，准备上架资料，未授权实际提交/发布/推送或独立版开发。

## 验证与待验
E60默认回归及83项专项通过；独立两样本首帧0.43/1.02秒，不能解释宿主十几秒整窗黑屏。实际日志有11月3日21:20:03 Eagle主窗口崩溃、21:25:34 NVIDIA ID153错误，未建立触发因果。绘制等待改为250ms计时退出；窗口调用加入int32保护及方法/坐标记录，未宣称重现截图。
本项目已限时启用startup-audit.local.json，自动写verification-runs/e60/startup-host-*.jsonl，24小时过期、最多10份/每份64KiB/160事件；配置不打包，不记录视频/标注内容，不上传。后续从用户正常使用的一次失败时间匹配启动轨迹和宿主日志，不要求固定次数测试。自动化宿主测试仍按用户要求停止，不再重复尝试。
E59兼容/资源证据保留，不因本轮诊断重复冒充宿主通过。[验收登记](experiments/E53/acceptance.md)/[能力限制](releases/motionote-capabilities.md)。private.7为诊断候选，包/冒烟/旧包清理以verification-runs/e60回执为准。

## 前端预览恢复
E60已打开并检查准备提示→合成首帧： http://127.0.0.1:5852/14ad3038c5a52fd11ad8b9f5a02d396cbbae/?scenario=e58-startup 。回执verification-runs/e60/preview-server.json，进程23104。旧E59服务/草稿保留。恢复命令node scripts/frontend-preview.cjs；只停止身份匹配服务。合成UI不验证原生窗口、多屏/GPU/音画。[长期流程](development-plan.md#前端预览与反馈流程)。

## 工作区
基线aab2923干净，无其它任务差异；[当前保留清单](workspace-exceptions.json)。输出限E60计划目录；保护限时诊断配置/原始证据，历史数据和E49冻结不变。E60结束后核对身份再移除本轮开启配置，保留证据；不能因Git忽略直接删除。

[阶段索引](experiments/README.md)
