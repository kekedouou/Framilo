# 当前交接

当前阶段：E-57
候选提交：E57源提交以新包BUILD-INFO为准（基线8268b2d）
候选状态：缓存/续播优化与本地检查完成；private.4自用候选，真实Eagle待验。

## 当前授权与结果
用户批准缓存优化、提交并打包替换旧包。[E57计划](experiments/E57/plan.md)/[结果](experiments/E57/report.md)。一项在做/最新待办、同帧复用、定向预解压、记录公平调度、松手播放请求及过期像素排空；画质/编解码/额度不改。自用、不发行、不推送；Eagle载入项目plugin，关闭重开即用新代码。E49冻结、E53/E54未验项延续。
新包dist/framilo-0.2.0-private.4-<源提交短号>-win-x64.zip及校验。提交后构建/包内取帧/旧包清理以verification-runs/e57的package-build.json、package-smoke.json及distribution-cleanup回执为准；核验后仅留最新一组，旧包需从源码和匹配构建重建。

## 集中体验待验
1. 真实Eagle检查慢拖、快拖/反向、松手立即空格续播/再次取消、原地暂停续播、循环和记录；重点比较热RAM与未缓存4K。模型/Node接收端不证明音画/物理显示手感。
2. 常用MP4/MOV/MKV/WebM、用户此前失败素材、GPU组合/色彩/4K及长期使用仍按[E53清单](experiments/E53/acceptance.md)登记，不承诺全素材通过或发行日期。
3. 大临时文件确认/拒绝继续原片、生成中退出和重开、真实标注安全及关闭体感待验；容量/格式边界见[能力表](releases/motionote-capabilities.md)。

## 前端预览恢复
入口：[同源检查页](http://127.0.0.1:12544/f5f0678391dc20b04725576d117a811bb02e/?scenario=e57)。旧服务已停；复用原样本恢复，回执verification-runs/e57/preview-server.json。内置浏览器已开/保留，查过空格切换、B记录/合成记录定位；未覆盖原生缓存/续播性能。旧回执、用户批注/草稿不动。
停止后Codex执行node scripts/frontend-preview.cjs，按新回执地址打开内置浏览器；只停止回执/命令行身份匹配的服务。不能假定跨重启常驻。合成数据不连接Eagle/真实素材，禁用原生窗控/清理，不证明GPU、音画、帧精度/性能。[长期流程](development-plan.md#前端预览与反馈流程)。

## 检查与工作区
全量回归通过；原生播放68模型、协议4项、UI39/Session52项及关闭/预算等覆盖。CPU/GPU已有H264与4K样本24次独立对照，最终源帧像素一致、关闭回执齐全；4K冷跳仍有等待且计时混合，不称全面P-01/P-02通过。详情及初期失败保存在[E57报告](experiments/E57/report.md)。
工作区登记：[当前保留清单](workspace-exceptions.json)
无其它任务差异；预算及清理范围见E57计划，只删核对后的旧交付文件。

## 历史导航
[阶段索引](experiments/README.md) · [E56](experiments/E56/report.md)
