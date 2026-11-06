# 当前交接

当前任务：AGENT-CONTRACT
任务状态：已完成
产品阶段：首个正式版本的上架前整体审查
维护记录：[协作规范精简与规则维护](progress/development-history.md#2026-11-06-协作规范精简与规则维护)
候选提交：0fa8818
工作区登记：[保留清单](workspace-exceptions.json)

## 目标与授权
用户批准此前规范优化方案，明确保留“相关目录内的AGENTS.md”的简短表述，不追加原型/演示说明。基线cc27440，工作区干净；范围为AGENTS、开发流程、验证协议、项目地图、交接、历程及当前token计量。沿用中英文分工，精简一级规则、补齐二级细则和导航，检查后提交本地Git；本轮不继承旧任务的远端推送授权。

只修改文档，不改播放器、测试/检查脚本、依赖或打包产物。词表核对最多读取5MiB公开数据到内存，不新增下载文件；无媒体生成、素材库写入或历史清理。原上架审查包、仓库改名与推送证据见[此前交付](progress/development-history.md#2026-11-04-首个正式版本审查交付)，不改写旧记录。

## 完成条件
逐条核对原规则的保留/下放位置；新增查证、止损、引用核实、自然语言验收和重复问题维护规则不扩大权限。当前文档链接、预算、交接及差异检查通过，报告参考token变化并完成本地提交；检查脚本不冒充语义或客户端点击保证。

规范与二级细则已同步，58项文档治理回归通过；AGENTS参考token由1106降为767，减少30.65%。原规则去向、检查和未改范围见维护记录。提交后的工作区核对结果在交付回复报告。

## 验收与接续
播放器仍为0fa8818；[审查包](../dist/framilo-1.0.0-store-review.1-0fa8818-win-x64.zip)来源不变，原运行/许可/ZIP摘要回执在verification-runs/bugfix-four/review1-package.json。包是store-review.1，不是已获商店批准的.eagleplugin安装包；展开目录仍供整体审查，不作为新安装入口。

此前集中体验通过的范围保留。NOTE-02仍“未修复、负责人接受本阶段暂缓”；重启恢复不是代码修复证据。PLAY-03、NOTE-01、UI-01不扩展为全设备/素材通过；真实IME、外部安装升级及整体提交审查的缺口见[问题登记](acceptance.md)。本轮文档完成不代表播放器新验收或公开发行。

## 前端预览恢复
预览回执：verification-runs/e52/frontend/server.json

本轮无可见交互变化，不启动预览、不要求重启播放器。需要恢复时，由Codex运行node scripts/frontend-preview.cjs并读取新回执，核对入口实际可用，保护样本和待反馈草稿；不沿用重启前PID或宣称旧地址在线。浏览器合成输入不代替Windows/Eagle输入法验收。

[项目地图](project-profile.md) · [开发历程](progress/development-history.md) · [历史工作包](experiments/README.md)
