# E-35 缓存长会话与分段原子提交

2026-10-25，承接用户“持续开发到最终版本、遇决策或必须亲自体验才停”的既有授权。E34已在c14aa9a保留原生解码、短/5分钟就绪性能及两次30分钟后台失败，详见[E34报告](../E34/report.md)。本阶段是该批准方向中的结构修复；不新增用户流程、依赖、画质损失、资源额度或动效取舍，不交用户陪测未通过的自动关卡。

## 原因与实现边界

E34后台每约2秒重走全根inventory、begin安全盘点和touch全owner查找。两处关联改成Map后，15分钟只由272增至401/900段，仍失败。只缓存manifest解析不能解决大量重复文件I/O。改为在排他writer持有期间统一管理多段：首次完整恢复/身份/预算/最大使用顺序核对，段间沿同一账本计费，各段仍独立原子发布及原租约读取；结束再全根复核。

正式cache增加openBatch({sourceSha256:原SHA,previewQuality,sessionSignal})，返回beginSegment({sourceSha256:派生SHA,previewQuality,signal:本段取消})、snapshot、close。子事务保持原readComplete/writeFrame/finish/abort/close接口；只有所有本段进程、输出及临时产物已结束才归还根writer。前台未准备目标可抢占后台后复用该会话；已有帧继续client本地读，不排写队列。JPEG继续原begin路径。

后台容量判断使用writer已核对账本，不调用拒绝writer的公共inventory；128MiB停止余量及两模式共用5GiB不变。touch由排他会话的最大序号递增，逐目标owner身份及原子替换仍保留。全部known字节增减包含临时输出、manifest、owner替换、current记录、lease、abort与清理回执；满额仍按原安全清理或停止，不用估计绕开预算。任何跨await复用只依据持续持有的原排他锁，不把文件时间戳当内容凭据。

## 持久化与恢复关

根writer不可变并明确mode=batch-v1，原SHA不能推断当前子事务目标。增加至多两个各≤4KiB的writer-current-<token>.json / writer-current-<token>.next.json，绑定原writer摘要、守护身份、递增sequence、本段token/派生SHA/画质/精确target及previousSha256。旧writer与旧清理/恢复记录继续原分支，不修改视频/圈画/已发布缓存manifest格式。

先写next、fsync、独立读回身份/字节，再原子替换current，随后才允许新partial、owner.next或FFmpeg。旧子事务未完全收尾不能换目标。current保留到下次替换或batch关闭。盘点全部写入、读取、usage、reaper、recencyRepair、orphanPartialPlan、恢复回执、根白名单和预算入口；不可只更改写入端。

逐点测试next创建/半写/fsync/替换前后、partial/manifest/owner.next/发布/租约返回、current删除及根writer删除处的中断后重新启动。新目标不能由损坏next授权；有partial/owner.next而current缺失或损坏时保留并报错，不能从firstkey或目录名猜测。仅有精确保留元数据残片时也须核对已停止守护身份和文件指纹后按有界回执清理。关闭/恢复失败不得释放未知归属或假报成功。运行期children只在全部closed边界收敛，覆盖超过32段。

## 模块与并行分工

cache及可选cache-writer-session纯协调器负责权限/持久化/预算；long-media仅持有同源批量能力并创建子事务；proxy-background只调度/抢占/保留租约，worker仍单一串行队列。维护、新source prepare、JPEG互切、背景完整或额度停止、窗口关闭必须按队列顺序关闭相应batch。不能在队列回调内部enqueue关闭再await造成死锁。IPC不传batch能力，不修改原manifest以便客户端adopt通过。

## 验证预算与门槛

先默认内存/故障模型与Node16兼容；模型不生成媒体。显式真实文件中断关仅用verification-runs/e35-cache，最多4轮、每轮64MiB/两分钟、证据8MiB，使用自建元数据/字节，不取真实素材；每轮最多两个独立caseRoot的自有Windows测试Job并行，不运行FFmpeg。写身份/摘要/清理回执，杀进程仅针对本脚本持有的精确Job/child句柄并等待实际退出。默认覆盖完整中断矩阵，定点group或超时缺项只能incomplete，最终各项须对应同一最终源码，预留修复复验轮次。未通过所有持久化读写及中断闭环前不安排新媒体轮次。实际媒体关卡与预算在首关完成后另行登记，不能重置E34已封存轮数或运行历史入口。

R-02/03/04、P-01～04不变：就绪拖动P95≤50ms、全部输入与过时/无更新/最终目标一起报告；30秒与5/30分钟同场景比较；后台连续音画至少10分钟和全进程资源仍须独立验。未生成位置≤250ms低清预览仍未实现，不由批量writer自动补记通过。真实Eagle缺少现成控制通道，必要时集中人工体验是获准停点；自动关卡失败继续查因修复，不宣称最终交付。

默认/Node16纯模型、文档和命令日志独立放verification-runs/e35-checks，≤8MiB，不生成媒体，不占用真实中断轮数。必要失败保留，旧E34检查和媒体保持封存。

## 首关通过后的有声规模与连续播放关（2026-10-25追加）

aa8ad2ea3658063d9e82ed9e050148d1ce66a125ed8840a86f34191e92d91f5d缓存在batch-29649096c467f9f3中完整18项真实Job中断/恢复通过且清理完成，随后才开放本节媒体。使用独立verification-runs/e35-proxy，最多4轮、每轮3GiB临时空间/二十分钟/单个FFmpeg生成进程、总证据8MiB；不增产品5GiB或RAM额度。复用显式check-proxy-long.cjs --batch-writer --cache-gate=该记录，依次30秒、5分钟、30分钟720p60；后两者须引用同源码/同测量器已通过的30秒P95≤50ms与RAM基线。原E34预算继续封存。

画面仍为2秒简单网格复制延展，仅证明规模；另生成独立连续431Hz AAC轨，避免循环AAC编码延迟改变视频帧数。先一次完整解码为f32le参照，再启动worker，在四处比对按源时钟对齐的分段PCM原字节；参照、代理、音频及Chrome临时文件合计计入3GiB。它不是复杂VFX吞吐或物理音色/同步验收。

30秒首轮另用隔离测试worker在首个实际AVC包写入后暂停测试缝，绑定真实segmentSignal的取消、同writer/序号前台接续及无租约/partial残留；单项工作/关闭各20秒，只有自有guard确实关闭才允许整体清理。吞吐与浏览器后续使用未经该测试缝修改的正式worker。普通“看到partial后操作”不单独证明输出中的取消。

短与5分钟播放观察5.2秒，可背景提前完整而不伪称验证并行；30分钟必须在背景未完成时开始连续有声播放600秒，无供给停顿，媒体推进与实际墙钟差不超过250ms，并核对从观察起点至首提交、全部相邻提交及末提交至结束的最大无更新≤100ms、画面PTS相对音频输出时钟估计P95≤50ms/最大100ms、更新≥30次/秒。记录实际音频读取的非空有效范围，完整覆盖观察区间，不能只检查audioAvailable对象；物理音画仍未测。

全片就绪后分别执行120次真RAM未命中随机定位及240次60Hz往返，保留全部输入/替代/无更新/最终目标。10分钟事件上限250000、音频读取5000，溢出失败；原始数组gzip分块、摘要与身份清理回执保留。常规归档为失败摘要和清理回执预留2MiB，超预算写最小失败状态并明确原始数据未完整保全，不得留下假running或宣称通过。监测盘点异步执行，仍有I/O开销须说明。源码/测量器哈希在关卡、实际复制及结束再次核对。

首轮有声样本在PCM比较处失败，允许一次定点音频参照诊断：verification-runs/e35-audio，≤8MiB临时合成音频/小视频、三十秒、证据2MiB、单FFmpeg；仅比较2秒固定AAC在完整/seek/trim过滤链的首PTS、样本数与浮点差，不重跑拖动/规模或取真实素材，不改产品音频或放宽验收。先保全原始PCM片段及命令/结果，再按身份SHA回执清理；该诊断不重置e35-proxy四轮。

长片运行时可在e35-checks的8MiB日志范围内进行额外只读CIM采样：仅保留本次scratch的task-host/Chrome种子及后代、精确出生实例、WorkingSetSize等字段，不保留整机命令行、不终止进程、不改测量器。十到十五秒采样、最多十二分钟，未覆盖启动的时间明确注明；工作集求和可能重复共享页，不称唯一物理RAM/GPU内存或真实Eagle/P-03通过。

## Node16实时计量器修复的独立补充关

原四轮真实中断已全部结束并封存。第四轮以Eagle Node16运行时16/18通过，两项均因活动总盘点撞到另一lane正原子重命名的stage-reached.json.next而ENOENT，中断在目标逻辑前；source/cache仍为aa8，与18项Node24通过相同，未发现产品异常。修复仅将活动额度计量拆成readdir/lstat大小扫描，实际消失的ENOENT可跳过并计数，不读取/哈希活动文件；停止后的冻结、原字节、身份/SHA及删除前严格盘点不变。

新增verification-runs/e35-cache-node16，仅一轮完整18点/64MiB/两分钟/证据8MiB/最多两个自有Job，用Eagle自带Node16和显式--node16-recheck。脚本强制Node16并核对原四轮终态及已保全的同cache计量失败，不重置旧次数、不修改缓存代码、不运行媒体。仅作为运行时与已确认计量器缺陷的补充，不是扩大产品测试资源或免去失败。新记录原样保留运行时版本，原wx preload回执不覆盖。

执行状态：以上显式预算全部结束并封存。最终Node24/Node16各18点恢复、30秒/5分钟/30分钟有声规模与10分钟播放关通过，原失败及清理回执保留；本地自动关完成不代替宿主、资源与最终验收。后续先同一开发入口集中Eagle体验，不重置轮数、重复生成媒体或隐含增加预算；必要新技术检查依据实际反馈另行有界登记。
