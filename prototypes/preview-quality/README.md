# 发布后稳定性与画质实验

只用于获批E-01/E-02；正式插件继续在plugin维护，实际状态见[执行记录](../../docs/experiments/Evolution/report.md)，预算与权限见[计划](../../docs/experiments/Evolution/plan.md)和本目录AGENTS。源视频/标注只读；唯一入口已获准加载，用户已反馈实际打开并确认关闭，更新同一入口不需重新导入。

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
| selected-display.cjs / selected-display-client.cjs | 点击时仅处理明确选中MP4的短片段；独立生成、取消和清理；同窗口顺序切样只追加同一自有记录，校验上轮回执才续写 |
| prepare-host.cjs | 核对源与已准备副本后刷新唯一入口；使用过则须用户确认关闭，只更新已登记源码副本，保留缓存/设置 |
| scratch/、display.local.json | 本机媒体/唯一入口；旧固定对照及指针已退役，CLI capture仍可显式生成指针，界面不再读取它；均不进Git |

Codex显式命令（不要用户代输）：sources.cjs需要已有本机配置及新素材的明确ID；audit.cjs写一份新审计；quality.cjs的参数为素材别名、尺寸、格式、可选capture/full。默认三轮生成，full仅限已登记的≤7秒原生1080p样本；capture保留唯一待验数据，已有指针时拒绝。prepare-host不加载Eagle；smoke-observation仅启动自有观察工具；summarize只读。不得把这些有副作用命令加入默认检查或从文档自动重跑。

界面入口在scratch/host：普通播放仍自动准备整段720p JPEG。点击“所选视频1080p JPEG／PNG对照”时读取当次Eagle单选；同素材从当前时间附近取样，选择不同则从0秒取样，≤1秒/60帧，无音频。面板显示名称、源尺寸、取样时间和真实帧数；选择JPEG或PNG比较相同帧，按钮与【/】逐帧，原尺寸便于看细节。在Eagle换选后点击“读取Eagle当前选中视频”切换，退出/取消/换片等待释放及清理本片段，再继续；“返回普通播放器”会重新读取Eagle选择。对照不是完整新产品或整段1080p验收。

“开始内存记录”仅在普通播放器主动开启，每秒记录并显示缓存账目、插件所属进程、媒体处理和记录工具内存；缓存是进程内存的一部分，不能相加。用户正常使用、结束时停止或关闭即可，分析由Codex完成；不要求固定陪测时长。画质面板显示自身缓存RAM，进入时停止普通使用记录，不默认增加系统采样。真实GUI新流程、画质收益及长期趋势仍待用户反馈/真实记录。

原始源指纹与输出/失败/清理回执保存在根verification-runs/evolution-01，不能删除或覆盖来腾空间；scratch也不能递归清空。出现错误先看具体归属/时间/格式与原始记录，不通过调大额度或删除写锁掩盖问题。
