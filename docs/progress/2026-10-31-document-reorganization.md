# 2026-10-31 文档职责与交接整理

用户批准：按已审方案整理全部文档职责，落实新增原则原位合并/Git提交边界，保留历史证据、不改播放器功能；检查导航同步，提交本地Git，不推送。
基线3a6d5af（E51候选），本轮是维护单元，不创建新产品阶段、不修改R/P门槛或恢复旧实验授权。

## 归类与保全
| 对象 | 整理结果 |
| --- | --- |
| AGENTS/地图/交接 | 核心规则、按需导航、唯一现状各归其位 |
| 产品/架构 | 按功能/模块整合现行结论，旧批准细节按主题链接追溯 |
| 开发/验证/路线 | 分别维护流程与Git/F规则、验收契约、未来需求，不追加阶段补丁 |
| 历史/实验 | 旧正文完整迁存并修复相对链接，原始本机证据不动，全部阶段有索引 |
| 旧性能STATUS | 内容归档后删除独立文件，旧引用转历史；即时监测工作流仍保留 |

档案中的“当前/下一步/授权”只代表原时刻，不驱动现行任务。未被现行已批准条款替代的操作/安全细节继续有效，按产品/架构主题入口查阅。
- [AGENTS.md](../history/2026-10-31/agent-rules-before.md)
- [README.md](../history/2026-10-31/readme-before.md)
- [docs/project-profile.md](../history/2026-10-31/project-profile.md)
- [docs/progress.md](../history/2026-10-31/progress.md)
- [docs/product.md](../history/2026-10-31/product.md)
- [docs/architecture.md](../history/2026-10-31/architecture.md)
- [docs/development-plan.md](../history/2026-10-31/development-plan.md)
- [docs/verification.md](../history/2026-10-31/verification.md)
- [docs/roadmap.md](../history/2026-10-31/roadmap.md)
- [docs/performance/STATUS.md](../history/2026-10-31/performance-status-before.md)

原文件路径/工作区字节和基线blob SHA256、迁移后规范化摘要及旧文件导航变更见[保全清单](../history/2026-10-31/source-manifest.json)。正文保全核对允许相对链接迁移，不允许删改原结果；历史源字节还可从基线Git恢复。
冻结发布/实验文档只在必要时修正失效链接，指标、授权原文和结果不改；CHANGELOG记录发行/功能版本，本轮不冒充产品版本，不新增功能条目。性能WORKFLOW、能力表和原生README的现行技术契约未改变，无需伪改日期。

## 检查与限制
检查工具增加角色/唯一现状/入口容量/退休模块/阶段导航约束，并提供副作用明确的独立文档入口；语义合并由Codex审查，不声称脚本能理解全部冲突。
检查结果：
- node scripts/check.cjs --without-prepared-host通过：367份源码语法/依赖、现行功能套件、manifest/接线、文档及交接检查。没有生成真实视频、加载Eagle或写素材库。运行期间只迭代文档检查工具，末次工具改动另做针对回归与语法核对。
- node tests/document-governance.cjs末次23项通过，覆盖旧检查漏掉的正文状态冲突/导航缺口/退休模块、Windows CRLF、入口预算、越界路径、旧文件内容或暂存身份变化、干净新检出不要求本机未跟踪残留。
- node scripts/check-docs.cjs通过：173份Markdown、1285条本地链接/锚点，所有文档可从入口点击抵达、各阶段索引齐备；10份归档与基线逐正文核对，仅迁移链接/换行/历史说明。
- node scripts/check-handoff.cjs --base HEAD通过，识别并核验43项既有差异；精确scope清单登记在保全JSON，另以--scope-file复核。
- 默认必读三文件由118748降至5155字符，约减少95.7%（字符不是token）；AGENTS由63行降至28行，进度由1233行降至29行。
- 首次保全检查遇到工作区CRLF与Git LF字节摘要不同，正文一致；已分别记录工作区原字节/基线blob摘要，档案摘要按UTF-8/LF规范化，并增加换行回归。首次diff检查发现新脚本末尾多空行，已修正；不改播放器或原验收标准。
- git diff --check及提交范围/保留文件核对在最终提交前执行；提交后require-clean预期仍因43项已登记旧差异失败，实际命令结果以本次收尾输出为准，不声称工作区干净。无播放器功能改动，无新媒体生成、无Eagle/素材库操作，不需要性能重测；不以文档通过宣告原候选宿主/长稳通过。

## 工作区与提交
本轮提交仅包含文档及文档检查工具；原有43项差异不暂存、不删除，不修改既有索引中的3份探针。提交后require-clean仍将报告这些既有差异，不能声称干净。
原有差异的路径如下：
- codex-changes-button-probe-2.txt
- codex-changes-button-probe.txt
- codex-changes-button-restart-test.txt
- plugin/performance-dashboard.cjs
- plugin/performance-explainer.cjs
- plugin/performance-inbox.cjs
- plugin/performance-protocol.cjs
- plugin/performance-report.cjs
- plugin/performance-runner.cjs
- scripts/check-cold-report.cjs
- scripts/check-e41-bitrate.cjs
- scripts/check-e41-media.cjs
- scripts/check-e42-producer.cjs
- scripts/check-light-preview.cjs
- scripts/check-performance-view.cjs
- scripts/check-preview-report.cjs
- scripts/check-proxy-drain.cjs
- scripts/check-scrub-runtime.cjs
- scripts/check-source-preview.cjs
- scripts/cleanup-e41-performance.cjs
- scripts/performance.cjs
- scripts/probe-continuous-production.cjs
- scripts/probe-light-preview.cjs
- scripts/probe-preview-targets.cjs
- scripts/report-cold-performance.cjs
- scripts/report-e41.cjs
- scripts/report-e44-experience.cjs
- scripts/report-e44-filmcraft.cjs
- scripts/report-e44.cjs
- scripts/report-preview-experiment.cjs
- scripts/run-cold-performance.cjs
- scripts/run-performance.cjs
- scripts/run-standard-performance.cjs
- tests/performance-detail.cjs
- tests/performance-lifecycle.cjs
- tests/performance-monitor.cjs
- tests/performance-readable.cjs
- tests/proxy-strip-display.cjs
- tests/support/cold-browser.cjs
- tests/support/e41-browser.cjs
- tests/support/e41-quality.cjs
- tests/support/gpu-conditions.cjs
- tests/support/performance-browser.cjs

## 复盘
可复用做法：现状只留一处、要求按主题原位合并、阶段结果回报告、旧锚点随内容迁移。
曾经的问题：多处只叠顶部摘要，导致旧当前/退休模块残留；检查只识别阶段编号未覆盖正文职责。
采用的修正：主题主文档与历史分开，导航检查和针对失效场景的回归共同执行，不以提高文档预算或新增一条补丁解决堆积。
