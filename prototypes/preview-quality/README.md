# 发布后稳定性与画质实验

只用于获批E-01/E-02；正式插件继续在plugin维护，实际状态见[执行记录](../../docs/experiments/Evolution/report.md)，预算与权限见[计划](../../docs/experiments/Evolution/plan.md)和本目录AGENTS。源视频/标注只读，新Eagle入口载入单独确认。

| 文件 | 作用 |
| --- | --- |
| workspace.cjs | 新证据固定槽、磁盘写前限额、精确清单清理；不删旧证据/库 |
| sources.cjs | 从既有工具配置和明确素材ID只读核对、ffprobe；真实配置保存到被忽略的config.local.json |
| audit.cjs | 只读复算旧长期记录，追加新审计，不启动旧测量 |
| quality.cjs | 共同RGB参考→JPEG/PNG/必要的WebP，逐帧回读、成本和外部资源观察；有媒体生成副作用 |
| summarize.cjs | 只读逐行读取新记录，按原批次分组，不混算不同轮次 |
| observation.cjs | 窗口主动开关与每秒小数值投影，不积累完整历史 |
| observe-worker.cjs | 独立观察进程，只落匿名数值/角色计量，失败不控制播放 |
| smoke-observation.cjs | 显式短Windows工具检查，写新证据；不是GUI验收 |
| observer-browser.js | 实验工具条及1秒画质面板；通过正式Player的注入接口读取不同格式 |
| prepare-host.cjs | 核对源与已准备副本后生成/刷新唯一尚未使用入口；使用过则拒绝覆盖 |
| scratch/、display.local.json | 本机媒体/唯一待验入口和位置指针，不进Git；体验后按原清单退役 |

Codex显式命令（不要用户代输）：sources.cjs需要已有本机配置及新素材的明确ID；audit.cjs写一份新审计；quality.cjs的参数为素材别名、尺寸、格式、可选capture/full。默认三轮生成，full仅限已登记的≤7秒原生1080p样本；capture保留唯一待验数据，已有指针时拒绝。prepare-host不加载Eagle；smoke-observation仅启动自有观察工具；summarize只读。不得把这些有副作用命令加入默认检查或从文档自动重跑。

界面入口在scratch/host：默认正常播放器、观察关闭；用户点击开始才采样，停止/关闭落盘。画质面板先关闭普通会话，避免同时占两套RAM；返回后在Eagle再次调用本入口载入素材。面板1秒片段无音频，不是完整新产品或整段无损验收。真实GUI加载/画质收益、快拖/逐帧及长期自然使用仍以执行记录为准。

原始源指纹与输出/失败/清理回执保存在根verification-runs/evolution-01，不能删除或覆盖来腾空间；scratch也不能递归清空。出现错误先看具体归属/时间/格式与原始记录，不通过调大额度或删除写锁掩盖问题。
