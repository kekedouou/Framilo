# 当前交接

当前阶段：E-60
维护记录：[E60根因排查](experiments/E60/report.md)
候选提交：91b7618（private.7诊断源码）；精确来源见verification-runs/e60/package-build.json和包内BUILD-INFO
候选状态：E59实际体验未通过；E60真实日志已定位关闭末尾阻塞重开，代码模型确认旧窗口黑遮罩暴露。本轮按用户要求先查根因，未改运行代码；延迟细分、修复及拖动/GPU问题仍待完成，暂停上架准备。见[E60计划](experiments/E60/plan.md)/[报告](experiments/E60/report.md)。

## 当前授权与结果
用户确认E58第一项集中体验完成；新增异常不被这一确认覆盖。批准兼容/数据安全验证与全屏恢复卡顿、跨屏顶栏拖动失效、关闭失败和反复关闭重开变慢的集中修复。[E59计划](experiments/E59/plan.md)/[结果](experiments/E59/report.md)。每次关闭插件后再打开，截图时Unreal正好崩溃；因果尚未确定。
取消固定14天/次数/小时观察门槛；本轮完成后查询官方发布文档，准备上架资料，未授权实际提交/发布/推送或独立版开发。

## 验证与待验
两份真实startup-host轨迹指纹匹配private.7；首次就绪1.36/0.80秒。21:46:36重开旧窗口，21:46:56.976才重新初始化；当前会话清理到旧缓存释放锁的调用间隔22.625秒。实际应用/UI模型确认：关闭时空白黑遮罩被Eagle重开暴露，新UI等待旧缓存维护。1438组历史清理记录的只读校验耗时2.88秒，未细分全部延迟；证据见报告及reopen-correlation.json。21:47:10 NVIDIA153未建立因果。
下一步解除重开对历史缓存维护的依赖，保留当前媒体安全关闭并处理等待界面。默认/83项专项、包校验及CPU-GPU冒烟属此前本地证据；本轮仅诊断模型与只读测量，未修复或换包。[验收登记](experiments/E53/acceptance.md)/[能力限制](releases/motionote-capabilities.md)。
限时startup-audit.local.json写verification-runs/e60/startup-host-*.jsonl，24小时/10份/每份64KiB/160事件；不打包、不含视频标注、不上传。按用户要求停止宿主自动化，不要求固定次数体验；保留旧证据。

## 前端预览恢复
E60已打开并检查准备提示→合成首帧： http://127.0.0.1:5852/14ad3038c5a52fd11ad8b9f5a02d396cbbae/?scenario=e58-startup 。回执verification-runs/e60/preview-server.json，进程23104。旧E59服务/草稿保留。恢复命令node scripts/frontend-preview.cjs；只停止身份匹配服务。合成UI不验证原生窗口、多屏/GPU/音画。[长期流程](development-plan.md#前端预览与反馈流程)。

## 工作区
本轮基线dabe1ed干净，无其它任务差异；[当前保留清单](workspace-exceptions.json)。输出限E60计划目录；保护限时诊断配置/原始证据，历史数据和E49冻结不变。E60结束后核对身份再移除本轮开启配置，保留证据；不能因Git忽略直接删除。

[阶段索引](experiments/README.md)
