# E-38 记录

> E41追溯：本文保留当时实施/失败的历史说明。用户随后明确要求清理旧性能记录；除指定“流放之路”标准外，其余旧performance-reports/artifacts/performance运行及对应辅助副本已删除，不再声称原始文件仍存在。其它历史验证证据不在此次清理范围，见[E41回执说明](../E41/report.md)。

本地实现、模型及独立浏览器真实链路完成；真实Eagle监测体验未验。只诊断，没有优化播放策略、改编码或降画质，没有接受基准；本轮按明确要求不提交Git。三个既有Git界面探针继续原样暂存。

## 已实现

设置「性能监测」按需打开，默认关闭；实时观察、开始/暂停/继续/结束、标准测试、停止、报告打开和复制分析请求。状态、丢弃/截断、当前来源、缓存、结果、最近延迟图，333ms刷新。标准测试次数与超时可在面板折叠区修改。监测关闭不发新增读取/解码阶段事件，不启动采样定时器或写盘。

独立collector/runtime/runner/report/view模块复用正式Player事件；请求源PTS与提交身份对照，低清预览单列，手动rapid→release按手势关联释放后的准确延迟。正式测试三轮固定节奏，不等中间帧；每轮独立本地报告，原始事件、请求、统计、图表、摘要和分析分开。存储100轮/256MiB到限停止，不删除历史。schema2有文件hash和复算检查，schema1首轮保留兼容；新模块加入未来构建清单，但未构建/替换冻结发行包。

工作区导入/最新查找/分析登记/完整性校验脚本已实现。安装后只写自身performance-reports，状态明确未同步；工作区状态由正式脚本更新。BASELINE保持unset，AGENTS只负责活跃任务约定，无后台AI。

## 已运行与证据

| 检查 | 结果与边界 |
| --- | --- |
| 默认回归 `node scripts/check.cjs --without-prepared-host` | 最终通过；日志verification-runs/e38-handoff-check.log。最初沙箱禁止文件链接，保留e38-initial-check.log；按既有规则隔离提升后通过，不是产品逻辑修复 |
| `node tests/performance-monitor.cjs` | Node24和Eagle自带Node16通过；正常统计、源帧不符、暂停排除、取消、缺素材失败、截断、无对照、缺文件、统计篡改、优化证据不足拒绝。夹具不是性能数据 |
| 独立Chrome真实链路 | 三次预算已使用并封存。正式Player/task-client/guard/WebCodecs，只读现有素材、隔离缓存；不是Eagle窗口/音频/物理输入或低清回退整链 |
| 报告与按钮DOM | check-performance-view.cjs通过离线三类图表、按钮状态/动作、默认配置、1280与640窗口限位；操作对象为UI替身。证据verification-runs/e38/presentation-check.json及report-view.png |
| 交接 | check-handoff.cjs --base HEAD通过E38入口；不执行require-clean并假称干净：本轮禁止提交，三个旧暂存探针另有归属 |

实际命令：`node scripts/run-performance.cjs --source <显式已有素材路径> --tools tests/host/t0/config.local.json`。只读取工具配置，未启动旧实验。短素材为既有h264-cfr.mp4；两次真实VFX为已有49.301秒RIOT AV1/1440p，720p代理输出。

| 运行编号 | 记录结果 |
| --- | --- |
| 2026-10-27T06-24-48-148Z-c94fffaa | 短合成源，288请求：259新提交/24复用/5替代，成功P95 20.7ms。用于验证采集，不代表VFX表现 |
| 2026-10-27T06-30-00-868Z-83868a02 | RIOT，288请求：68新提交/24复用/196替代；成功P95 1534.4ms；最慢1944.3ms |
| 2026-10-27T06-45-12-434Z-80eb2b25 | 同条件RIOT复核，288请求：72新提交/24复用/192替代；成功P95 1354ms；最慢1916.5ms；缓存命中组P95 7ms |

最后两轮只是重复测量，-11.8%差异不能称为优化/统计显著。本轮未动播放策略；慢例0:1:81资源返回1832.4ms、浏览器解码2.5ms。资源返回仍混合准备/磁盘/IPC，不猜唯一根因。完整诊断位于最新run的analysis.md，入口见[性能状态](../../history/2026-10-31/performance-status-before.md)。

监测开销：最后一轮同帧关闭/开启/关闭/开启各60次，P95均约7.1ms；开启回调每事件约12.9/13.7微秒。此为轻负载采集对照，不能宣称零开销或涵盖Eagle面板合成。runtime另记录UI刷新耗时；实际Eagle面板和全进程/GPU资源未测。RSS在浏览器隔离链不可取得，明确null，未写0。

## 保护、收尾与限制

三份attempt回执记录原素材SHA前后一致、隔离进程结束及逐文件身份/hash清理；scratch已全部清理，报告/原始数据/截图保留。本轮没有素材库写入、插件安装、原片修改、用户缓存清理、收费API或上传。源码改动后仅补手动release分组模型，不重写已生成原始报告。实际Eagle进程未运行，仍需重开开发插件核验操作；不以纯Node16或独立Chrome代替。

文档影响已同步：README、project-profile、product、architecture、development-plan、roadmap、verification、progress、AGENTS与performance工作流/状态/基准。E36/E37报告、旧发行、已接受演示为历史冻结，不伪改日期/结论。本轮已结束，停止在诊断与待审阅，不继续优化。
