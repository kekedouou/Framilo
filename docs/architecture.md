# 现行架构与模块边界

本页按职责维护运行链；完成情况见[当前交接](progress.md)，批准行为见[产品](product.md)。源码主线只有plugin；旧原型和退休模块存在不表示仍运行。
第二阶段优化的开发预览适配、格式修复和临时缓存生命周期见[实施方案](experiments/E52/plan.md)，实际检查与限制见[报告](experiments/E52/report.md)。

## 运行链与数据边界
app装配/宿主生命周期 → UI发操作 → Session持有库/源快照和任务代次 → Eagle适配、媒体/缓存、播放器分别执行 → UI显示状态。
只有eagle调用素材/标注API；UI不直接读写素材或媒体目录，媒体不自行淘汰文件，缓存不调UI/素材API。入口不承载这些业务。
原片及完整代理统一FilmCraft原生读者，整数源PTS/序号及实际帧回执；音频是唯一播放时钟，YUV/WebGL准确绘制并可同帧CPU回退。日常入口统一proxy，旧JPEG代码保留共享依赖/回归，不再作为格式兼容选择。

## 现行模块地图
| 文件 | 职责与边界 |
| --- | --- |
| plugin/manifest.json、index.html | Eagle Window 与页面入口 |
| native/filmcraft/、plugin/bin/ | 固定FilmCraft来源/补丁/许可与本机原生运行EXE；开发源码不成为日常依赖 |
| plugin/native-backend.cjs、native-reader.cjs、native-wire.cjs | 原片异步索引/身份、常驻原生解码进程、有界协议、实际PTS与关闭回执 |
| plugin/native-audio.cjs | 有界压缩音轨复制、逐包内容/时序核对、源身份及取消，无磁盘缓存 |
| plugin/native-player.js、native-renderer.js | 原生播放/音频时钟、最新目标/缓存/闲时邻域/缩略图、YUV准确GPU绘制及CPU回退 |
| plugin/whole-proxy.cjs | 独立整片生产、完整校验/原子发布、取消/复用/容量及死owner恢复 |
| plugin/app.js | 宿主生命周期、依赖装配和事件接线，不承载媒体、缓存、标注业务 |
| plugin/ui.js、styles.css | 原始控件/输入路由、会话状态；正式可见布局由graphite模块承载，默认不显示帧数/秒数、带输入焦点保护的空格操作；只向会话发出操作，不直接访问文件或 Eagle 素材/标注 API；正式页面无测试控制 |
| plugin/graphite-shell.js、graphite.css、interface-icons.js | 视频优先布局、直角透明材质、图标、左工具/右记录、缩略图租约和标注输入位置；统一按钮提示、非交互标注退出动画副本；不访问素材库 |
| plugin/settings-view.js | 原设置控件的分级展示；子菜单中心跟随父项并在视口边缘限位；淡化输入横拖与取消只改控件值，保留原应用/即时生效写入端 |
| plugin/timeline-strip.js | 灰色带、蓝光标、白标注、内嵌片段、真实帧刻度；已撤下代理条 |
| plugin/window-drag.cjs | 宿主窗口恢复和拖动调度，不改播放核心 |
| plugin/loop-selection.js | UI层短/长按与端点草稿，只通过Session预览/确认；无文件、缓存或Eagle API访问 |
| plugin/timeline-view.js | UI纯显示映射：整段/循环片段范围、自适应刻度、时间坐标及绿条/标注裁切；非重叠点击区与密集标注分组由ui.js呈现选择列表；不解码或分配视频缓存 |
| plugin/drawing-model.js、drawing-erase.js、drawing-ui.js | 绘图对象/擦除覆盖/淡化计算及SVG显示、文字编辑；通过Session发操作，不直接访问Eagle或媒体缓存 |
| plugin/drawing-session.cjs、drawing-store.cjs、annotation-data/ | 同帧关联、草稿与永久图形/文字/样式存储；独立于会淘汰的预览缓存 |
| plugin/screen-gestures.js、screen-gesture-ui.js | 纯手势识别、指针/时钟和反馈展示；通过原Session定位/调速，不接入媒体解码 |
| plugin/context-wheel.js | 观看/圈画右键方向选择、单次打开预建并复用类型/颜色外圈、悬停取消及销毁；通过UI调用既有操作，无媒体或Eagle访问 |
| plugin/preview-profile.cjs | 720p/1080p/1440p/2160p预览尺寸与身份；共用原缓存预算，不放大小源 |
| plugin/session.cjs | 素材/库快照、状态与任务所有权，协调适配、准备、缓存和播放 |
| plugin/eagle.cjs | 唯一素材/标注 API 边界；独立读回，不直接写 metadata.json |
| plugin/export.cjs、export-work/ | 源视频图片/片段导出、本次暂存及本地保存；由既有后台任务执行，暂存累计1GiB、正常结束清本次，异常/导入未知保留核对，不受预览缓存清理器删除 |
| plugin/media.cjs | 只读源媒体、分析和 FFmpeg；转发proxyBudget/closeProxyBatch，通过缓存句柄受限写入，不自行淘汰目录 |
| plugin/media-wire.cjs | 整数PTS/共同时间基准/显式结束时间的紧凑控制协议，≤6MiB/120000帧、摘要/版本检查及无损重建；不读素材或改源SHA |
| plugin/cache.cjs | 文件所有权、路径、预算、锁、完整提交、淘汰与清理；openBatch/beginSegment/snapshot/close、双槽目标记录、失败退款与原计划恢复；完整manifest备忘仍每次SHA核对字节，不备忘可变归属记录，不操作UI或素材元数据 |
| plugin/preferences.cjs | RAM档位/物理上限、画质与交互偏好、旧JPEG/额度只读迁移和本地原子保存；不访问素材库或清理媒体缓存 |
| plugin/process-identity.cjs | Windows进程出生/后代只读证明；独占句柄核对后接管空writer记录；未知时保留，不终止进程、不调用Eagle API |
| plugin/task-client.cjs、task-worker.cjs、native/task-host.cs | 窗口与后台请求、按回执合并最新位置/记录意图、Windows互斥与任务组；worker单队列处理同源抢占及维护/换源/关闭时batch收尾，客户端原租约借读；控制消息不传图片，历史基础见A-07 |
| plugin/frame-pack.cjs | 校验集中JPEG/AVC帧包的纯布局及videoEncoding；物理文件读写仍归cache |
| plugin/frame-index.cjs | 纯时间/源帧映射；整数 PTS、呈现编号与源时间关系 |
| plugin/player.js | JPEG及历史播放器；当前proxy模式使用native-player。Canvas、Web Audio、旧代理解码注入与调度；通过缓存读取/预算句柄取得资源，不调用标注API |
| tests/、scripts/check.cjs | 隔离测试与统一检查；正式代码不依赖 prototypes，开发检查不进入产品 UI |

| plugin/media-policy.cjs、load-decisions.cjs | 纯格式/时长/体积策略与Session持有的可取消选择；不写媒体/Eagle，绑定任务代次 |
| plugin/proxy-storage.cjs | 整片代理独立预算、文件归属、读者租约、最近使用和安全淘汰；不碰原视频或标注 |
| plugin/performance-runtime.cjs、performance-core.cjs、performance-stages.cjs、live-resources.cjs | 有界即时等待/资源观察与采样生命周期；关闭取消，旧源结果不发布 |
| plugin/performance-view.js、performance-window.html/js、performance.css | 独立即时监测界面；无旧记录/报告/标准测试产品流程 |

## 媒体、音频与调度
- native-backend管理源身份/异步packet索引，native-reader/wire管理常驻原生进程、有界协议及关闭回执。重复/缺失PTS不猜测；定位/逐帧/标注基于实际源帧，旧代次不能覆盖。
- 原片先可播放，whole-proxy后台连续生产一份H.264全I，完整帧数/时间映射/尺寸/内容核验后原子发布并同帧接管；不随鼠标重启。CPU/NVENC保留原配方，奇数尺寸用偶数编码/SAR恢复；2160p由编码器选level，旧尺寸维持5.1。
- native-audio无损复制压缩音轨到有界stdout，逐包内容/PTS/DTS/有效边界/编码初始化核对；任务前后核对inspect的source.nativeStamp。零起点已验，其它形态保守回原声，源改变/取消不能静默回退。
- Player先为收集/合并/Blob峰值预留，音轨上限剩余额度1/3且≤32MiB，完成按实际字节×2计费；关闭卸载、撤销URL、释放预算。播放不等待audio.play承诺才启动绘图，静止时钟不抢跑；暂停复用有效音频游标，显式seek清旧续播归属。
- 原生热帧单次通知/绘制，预算按kind增量统计；暂停/热拖动用同一reader闲时补邻域，冷目标抢占。最多4096邻域帧、受RAM/像素/在途额度限制；后台不画面、不改标注身份、不无限重试。JPEG仅已完成热目标豁免80ms静默期。

## 准备选择与取消
preview-profile统一720p～2160p几何/身份，原生桥像素边界支持UHD及竖屏；格式与阈值的单一参数入口见[能力表](releases/motionote-capabilities.md)。
media-policy只算策略，load-decisions一次一个选择并绑定请求ID/代次/AbortSignal，只有当前合法答复生效。换源/切模式/关闭使旧选择失效。
whole-proxy在同窗口完整复用核验后、写锁前确认累计预计超过1 GB的任务；实际超额停止/回收未完成文件，再确认重启。MP4族与Matroska族实际PTS分别取自原生读者，禁止用请求时间冒充回执。音轨边界从真实packet PTS/末包duration得出；MKV/WebM/PCM使用原文件HTMLAudio，其它仍优先已验证压缩音轨，复制边界不符时使用原文件；先确认音轨可读，不静默无声。

## 缓存、持久化与退出
- cache保留旧JPEG文件所有权、真实路径、锁和完整提交以安全迁移；proxy-storage管理本窗口代理资产/读者租约，正式temporary路径不靠跨次LRU复用。受管额度与OS/驱动进程占用不同。
- 原生单读者GOP约128～192MiB，接管预留第二读者；帧、缩略图、YUV/RGBA、绘制表面及在途纳入账本。管道/驱动边界与采样另报，不假称程序硬上限。
- whole-proxy失败先进入cleaning，等待受管进程停止，再核对realpath、owner token/pid、文件身份与白名单，只回收本任务未完成产物；确认后发布终态。失败保留锁及WHOLE_CLEANUP_FAILED，不把缺owner误当已清空；NVENC回退CPU前同样确认回收。
- 清理保护当前源所有画质、活动读写和未知文件；进程归属以出生/后代/独占访问证明，不凭PID消失或锁年龄删除。文件整理见[F规则](development-plan.md#文件整理f-01f-07)。
- Session等待实际取消、子进程/流/读者/租约/缓存收尾，宿主关闭请求不等同完成；未知结果/草稿保留。偏好、圈画和永久标注独立于可淘汰缓存；偏好原子保存、旧格式兼容和全部读写端见验证协议。

## 即时监测
usage用异步lstat/realpath/opendir逐文件扫描，支持AbortSignal；单文件消失只跳过该文件，不归零既有累计。
资源约2.5秒采样、磁盘至少5秒校准，不堆积扫描；关监测取消扫描/自有采样进程，源切换旧结果失效。相同事件不重算快照，等待时间仍每100ms更新。分类口径和验证见[工作流](performance/WORKFLOW.md)。
Session仅在释放成功后将SELECTION_EMPTY映射正常empty；SDK/释放故障保持error，不隐藏故障。

## 临时媒体与开发预览
- `temporary-media.cjs`为每个窗口建立`cache/sessions-v1/<随机id>`，登记owner/启动身份/子进程意图；全程生成路径局限其中。关闭必须先停止原生读者、探测与编码子进程，再核验目录归属并原子改名为retiring后删除；未知文件/活动进程/不完整出生身份保留。无遗留时身份查询异步，不阻塞首帧或关闭；恢复旧会话才使用完整进程快照。
- `media-space.cjs`统一十进制1 GB累计确认、2 GiB物理余量、100 GiB内部保护与跨窗口原子预留；预留与输出字节上限都由生成层执行，UI不直接计数。`space.json`在任务终止后释放，崩溃由owner恢复处理。
- `legacy-media-cleanup.cjs`在正常关闭新运行链后，调用旧cache所有权/读者检查清理已确认的旧JPEG与完整代理；旧PID-only读者记录缺出生证据时保护，不猜测删除。旧cache不再复用，首次升级的旧数据在首次正常关闭迁移。原片、annotation-data、偏好和验收证据不进入删除白名单。
- `scripts/frontend-preview.cjs`仅开发使用：loopback随机令牌/Host-Origin/GET白名单；共享正式HTML/CSS/UI和Session，`scripts/preview`只替换播放器与Eagle/存储适配。示例写入sessionStorage，不进入产品包。原生窗控、GPU、缓存清理及性能入口禁用；浏览器样本不能证明原生精度、音画、缓存或Eagle数据读写。

## JPEG保留与退休模块
| 模块 | 保留用途 |
| --- | --- |
| plugin/long-media.cjs | JPEG及历史分段共享实现（原生不调用分段链）；源帧索引、JPEG或全IDR AVC/PCM分段与源身份核对；120000帧/64MiB索引上限，持有同源batch、分段取消与统一关闭；音轨起点/两秒预热及audio-preroll-v2派生键 |
| plugin/avc-access-units.cjs | Annex-B流拆分、AUD/SPS/PPS/IDR框架与8MiB单帧保护；不负责证明完整H264语法或像素正确 |
| plugin/proxy-decoder.js | 常驻WebCodecs解码、两项在途、受控flush、ImageBitmap所有权及关闭等待；无文件或Eagle访问，硬件偏好不等于实测加速 |
| plugin/proxy-background.cjs | 前台优先的渐进代理准备、段描述/租约保留及writer账本额度判断；背景完整/容量停止先等batch核对关闭，不把整片图像常驻RAM |
| plugin/segment-reader.cjs、segment-audio.cjs | 受限分段读取/借用归还、共享时钟音频排程；关闭等待实际读取与释放 |

上表分段/AVC/WebCodecs实现仅供JPEG共享或历史追溯，不在当前原生代理前台链调用。旧性能dashboard/explainer/inbox/protocol/report/runner及标准测试脚本已退役，不进现行模块地图或发行清单；40份旧源码已保存在[历史归档](history/retired-performance-2026-10-31/README.md)，原位置文件按批准范围移除。
A-01～A-08、双槽记录/维护事务、关闭互斥与旧JPEG细节按任务查[原架构条款](history/2026-10-31/architecture.md#模块依赖与数据流)、[A-07生命周期](history/2026-10-31/architecture.md#a-07-任务生命周期与快速关闭交接2026-10-15-用户批准整改)、[A-08帧包](history/2026-10-31/architecture.md#a-08-jpeg集中存储与批量预载2026-10-16)。未被现行链明确替代的安全约束继续有效，历史限额/授权不自动恢复。
