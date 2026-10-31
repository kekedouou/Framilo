# 项目地图

唯一现状入口：[当前交接](progress.md)。本页只管项目身份、任务导航和命令，不维护第二份进度。

## 项目身份与目录
- Windows x64 / Eagle 4.0 Build 22+的独立窗口视频播放器；唯一正式实现[plugin](../plugin/manifest.json)。HTML/CSS/JavaScript、Eagle API、FilmCraft原生桥、现有FFmpeg/ffprobe；Rust只用于开发构建。
- [native/filmcraft](../native/filmcraft/README.md)保存源码、来源与许可；运行依赖plugin/bin，不依赖原型或开发工具。实际已测Eagle Node16.17.1/Chrome108，开发默认Node24。
- tests是检查，scripts是开发工具；prototypes和demos是封存探索/演示，不是第二套主线。修改这些目录先读局部AGENTS。
- verification-runs及原型evidence是本机原始证据；plugin/cache是生成缓存，annotation-data是永久圈画，memory-settings.json是本机偏好。不能因Git忽略而删除。
- dist仅构建/安装验收暂存，日常安装位于用户指定的仓库外非C盘目录；整理见[文件规则](development-plan.md#文件整理f-01f-07)。

## 按任务阅读
| 要做的事 | 只读对应入口及关联章节 |
| --- | --- |
| 恢复任务、确认授权和待验项 | [当前交接](progress.md) |
| 产品行为、UI/提示、R/P要求 | [产品规范](product.md) |
| 模块定位、数据/进程/缓存边界 | [架构与模块地图](architecture.md) |
| 执行流程、新增原则归类、Git或清理 | [开发与维护流程](development-plan.md)；[中英文分工](development-plan.md#文档语言规则) |
| 选择检查、持久化/关闭/异常验收 | [验证协议](verification.md)（英文正文，中文导航） |
| 寻帧/解码/缓存/调度等性能工作 | [性能工作流](performance/WORKFLOW.md)及受影响架构章节 |
| 格式、画质与长片能力 | [候选能力表](releases/motionote-capabilities.md) |
| 未来需求、优先级与待决项 | [路线图](roadmap.md) |
| 某阶段方案、实测或失败 | [实验索引](experiments/README.md)，只读目标阶段 |
| 冻结/发布与安装恢复 | [E49冻结记录](releases/e49-frozen-2026-10-30.md)、[Beta2发行](releases/v0.1.0-beta.2.md)、[Beta使用](beta-preview.md) |
| 追溯旧规则与旧入口 | [整理与历史索引](progress/2026-10-31-document-reorganization.md)；[退休性能源码](history/retired-performance-2026-10-31/README.md)（只读，不执行） |

## 命令及副作用
| 命令 | 用途与边界 |
| --- | --- |
| node scripts/check-docs.cjs | 只读检查文档链接、角色、现状唯一性及导航 |
| node scripts/check.cjs --without-prepared-host | 语法、现行功能回归、manifest及文档；测试可能使用自有隔离夹具，不生成真实视频、不加载Eagle或写素材库，不恢复停用T2入口 |
| node scripts/check-handoff.cjs --base HEAD | 提交前只读检查；使用本轮基线或精确文件清单隔离其他任务 |
| node scripts/check-handoff.cjs --require-clean | 提交后核对；有其他任务差异会失败，须登记且不能声称干净 |
| node scripts/package-release.cjs native-experience | 只读核对原生运行文件及许可闭包，不生成ZIP；仅运行文件变化时需要 |
| node scripts/build-task-host.cjs | 构建Windows后台程序并写本机指纹；相关源码变更/新检出时由Codex执行 |

历史Beta打包build/verify/extract/verify-install、旧原型reset/媒体/清理命令须先读对应计划与局部规则；旧验收目录可能已清，不默认复跑。发布包、标签和原始证据含义不同；本地提交不会自动发布。
