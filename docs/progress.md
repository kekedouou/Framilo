# 当前交接

当前阶段：E-58
候选提交：E58源提交以新包BUILD-INFO为准（基线924d177）
候选状态：光标/启动/容量提示及AAC兼容修复、本地检查完成；private.5自用待验。

## 当前授权与结果
用户批准修复、调查指定4K素材并打包替换旧包。[E58计划](experiments/E58/plan.md)/[结果](experiments/E58/report.md)。续播不再被旧定位意图锁住光标，先显示准备状态再初始化，容量确认隐藏次要进度。雷神片音轨复制的时长元数据误判已修正；逐包内容/精确时间/末尾仍核对，原声不重压。编码、画质、RAM及E49冻结不改。自用、不发行、不推送。
新包dist/framilo-0.2.0-private.5-<源提交短号>-win-x64.zip及校验；提交后构建/包内取帧/旧包清理以verification-runs/e58的package-build.json、package-smoke.json和distribution-cleanup回执为准。核验后仅留最新一组。Eagle载入项目plugin，关闭重开即用新代码。

## 集中体验待验
1. 真实Eagle冷帧续播光标、首次加载、容量确认，尤其《复联3》拖动后立即空格/再次取消及音画；复制音轨已核对，不代表宿主延迟已实测。
2. [E53长期清单](experiments/E53/acceptance.md)/E54数据关卡继续；全素材/4K/GPU色彩组合及真实标注安全未全面验收。[能力限制](releases/motionote-capabilities.md)不扩大。

## 前端预览恢复
[启动检查页](http://127.0.0.1:12544/f5f0678391dc20b04725576d117a811bb02e/?scenario=e58-startup)已在内置浏览器保留；同根?scenario=e58-capacity检查容量框。复用E57服务/旧样本，回执verification-runs/e57/preview-server.json；旧草稿/批注不动。已见准备状态→首帧、确认时无小字、选择后普通提示渐隐。
服务停止后Codex执行node scripts/frontend-preview.cjs，按新回执恢复；只停止身份匹配的服务。合成UI不连接Eagle/真实素材，不验证原生/GPU/音画/性能。[长期流程](development-plan.md#前端预览与反馈流程)。

## 检查与工作区
全量回归通过；新增35项UI/音轨组合检查及启动关闭/重开。指定素材8次有界调查/读取：复制前后PCM哈希一致，CPU/GPU原生准确帧一致、使用1.2MiB独立原声音轨且关闭回执齐全；音频时钟为Node模型，真实听感待验。详情见E58结果。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务差异；预算、证据及旧包精确清理见E58计划/回执；不删永久数据或历史证据。

[阶段索引](experiments/README.md) · [E57](experiments/E57/report.md)
