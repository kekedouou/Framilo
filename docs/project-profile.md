# 项目地图

唯一现状入口：[当前交接](progress.md)。本页只管项目身份与任务导航，不维护第二份进度。

## 项目身份与目录
- Windows x64 / Eagle 4.0 Build 22+的独立窗口视频播放器；唯一正式实现[plugin](../plugin/manifest.json)。HTML/CSS/JavaScript、Eagle API、FilmCraft原生桥、现有FFmpeg/ffprobe；Rust只用于开发构建。
- [native/filmcraft](../native/filmcraft/README.md)保存源码、来源与许可；运行依赖plugin/bin，不依赖原型或开发工具。实际已测Eagle Node16.17.1/Chrome108，开发默认Node24。
- tests是检查，scripts是开发工具；prototypes和demos是封存探索/演示，不是第二套主线。修改这些目录先读局部AGENTS。
- verification-runs及原型evidence是本机原始证据；plugin/cache是生成缓存，annotation-data是永久圈画，memory-settings.json是本机偏好。不能因Git忽略而删除。
- 日常直接更新已注册的仓库plugin并重新打开；dist只用于明确打包任务，不默认ZIP或迁出仓库。整理见[文件规则](development-plan.md#文件整理f-01f-07)。

## 文档层级
AGENTS全局底线 → 本地图按任务导航 → 领域规范（产品/交互、架构、验证、开发流程）。
路线图管未来方向；交接管当前目标/授权；验收管问题和证据范围；历程串联开发、优化、修复及回访。旧实验/发行保存当时证据，不作为现行指令。
UI持续维护产品的交互章节，暂不另拆一套文档。阶段任务引用领域条款，不复制规范；完整职责/更新时机见开发流程。

## 按任务阅读
| 要做的事 | 只读对应入口及关联章节 |
| --- | --- |
| 恢复任务、授权与接续 | [当前交接](progress.md) |
| 问题复发、体验/数据与待验 | [当前验收](acceptance.md) |
| 大阶段、开发/优化/修复及替代决定 | [开发历程](progress/development-history.md) |
| 前端可见改动、预览与批注交付 | [长期预览流程](development-plan.md#前端预览与反馈流程) |
| 产品需求、行为与R/P | [产品规范](product.md) |
| UI操作、布局、提示 | [交互](product.md#操作与界面)、[提示](product.md#提示与错误反馈)；持续更新同一领域 |
| 模块定位、数据/进程/缓存边界 | [架构与模块地图](architecture.md) |
| 执行流程、新增原则归类、Git或清理 | [开发与维护流程](development-plan.md)；[中英文分工](development-plan.md#文档语言规则) |
| 选择检查、持久化/关闭/异常验收 | [验证协议](verification.md)（英文正文，中文导航） |
| 寻帧/解码/缓存/调度等性能工作 | [性能工作流](performance/WORKFLOW.md)及受影响架构章节 |
| 格式、画质与长片能力 | [候选能力表](releases/motionote-capabilities.md) |
| 未来需求、优先级与待决项 | [路线图](roadmap.md) |
| 某阶段方案、实测或失败 | [实验索引](experiments/README.md)，仅追溯相关工作包 |
| 自用安装/恢复、历史发布 | [Framilo自用](releases/framilo-private.md)、[E49冻结](releases/e49-frozen-2026-10-30.md)、[Beta2发行](releases/v0.1.0-beta.2.md) |
| 追溯旧规则与旧入口 | [整理索引](progress/2026-10-31-document-reorganization.md)；[旧性能体系](history/retired-performance-2026-10-31/README.md)、[退役监测](history/retired-monitor-e55/README.md)（只读，不执行） |

命令和副作用按需查[执行命令](development-plan.md#命令及副作用)，不默认运行历史实验或打包。
