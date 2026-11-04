# 现行架构与模块边界

本页按职责维护运行链；完成情况见[当前交接](progress.md)，批准行为见[产品](product.md)。源码主线只有plugin；旧原型和退休模块存在不表示仍运行。
预览适配、格式和缓存边界维护在下文；[E52方案](experiments/E52/plan.md)及[报告](experiments/E52/report.md)只追溯当时范围与证据。

## 运行链与数据边界
app装配/宿主生命周期 → UI发操作 → Session持有库/源快照和任务代次 → Eagle适配、媒体/缓存、播放器分别执行 → UI显示状态。
只有eagle调用素材/标注API；UI不直接读写素材或媒体目录，媒体不自行淘汰文件，缓存不调UI/素材API。入口不承载这些业务。
原片及完整代理统一FilmCraft原生读者，整数源PTS/序号及实际帧回执；音频是唯一播放时钟，YUV/WebGL准确绘制并可同帧CPU回退。日常入口统一proxy，共用规则抽入playback-common；旧JPEG前端退出HTML与打包，只供开发回归，不作为格式兼容选择。

## 现行模块地图
| 文件 | 职责与边界 |
| --- | --- |
| plugin/manifest.json、index.html | Eagle Window 与页面入口 |
| native/filmcraft/、plugin/bin/ | 固定FilmCraft来源/补丁/许可与本机原生运行EXE；开发源码不成为日常依赖 |
| plugin/native-backend.cjs、native-reader.cjs、native-wire.cjs | 原片异步索引/身份、常驻原生解码进程、有界协议、实际PTS与关闭回执 |
| plugin/native-audio.cjs | 有界压缩音轨复制、逐包内容/时序核对、源身份及取消，无磁盘缓存 |
| plugin/native-player.js、native-renderer.js | 原生播放/音频时钟、最新目标/缓存/闲时邻域/缩略图、YUV准确GPU绘制及CPU回退 |
| plugin/whole-proxy.cjs | 独立整片生产、完整校验/原子发布、取消/复用/容量及死owner恢复 |
| plugin/app.js | 宿主生命周期、依赖装配和事件接线；重建界面成功后才提交重开状态，失败保留可重试关闭状态；不承载媒体、缓存、标注业务 |
| plugin/window-fit.cjs、window-drag.cjs | 首次源尺寸适配当前屏幕工作区、窗口拖动恢复；保护全屏/最大化/用户改窗/旧源回调，不改媒体像素或帧坐标 |
| plugin/ui.js、styles.css | 原始控件/输入路由、会话状态；正式可见布局由graphite模块承载，默认不显示帧数/秒数、带输入焦点保护的空格操作；只向会话发出操作，不直接访问文件或 Eagle 素材/标注 API；正式页面无测试控制 |
| plugin/graphite-shell.js、graphite.css、interface-icons.js | 视频优先布局、直角透明材质、图标、左工具/右记录、缩略图租约和标注输入位置；统一按钮提示、非交互标注退出动画副本；拆卸先归还借用控件，再拆设置容器；不访问素材库 |
| plugin/settings-view.js | 原设置控件的分级展示；子菜单中心跟随父项并在视口边缘限位；淡化输入横拖与取消只改控件值，保留原应用/即时生效写入端 |
| plugin/timeline-strip.js | 灰色带、蓝光标、白标注、内嵌片段、真实帧刻度；已撤下代理条 |
| plugin/loop-selection.js | UI层短/长按与端点草稿，只通过Session预览/确认；无文件、缓存或Eagle API访问 |
| plugin/timeline-view.js | UI纯显示映射：整段/循环片段范围、自适应刻度、时间坐标及绿条/标注裁切；非重叠点击区与密集标注分组由ui.js呈现选择列表；不解码或分配视频缓存 |
| plugin/drawing-model.js、drawing-erase.js、drawing-ui.js | 绘图对象/擦除覆盖/淡化计算及SVG显示、文字编辑；通过Session发操作，不直接访问Eagle或媒体缓存 |
| plugin/drawing-session.cjs、drawing-store.cjs、annotation-data/ | 同帧关联、草稿与永久图形/文字/样式存储；独立于会淘汰的预览缓存；保存/清理共用独占租约 |
| plugin/drawing-lifetime.cjs | 分批异步圈画维护、活动素材保护/关闭失效；经eagle适配只读确认永久删除后，交store定点清理，不访问媒体/库写入 |
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
| plugin/frame-index.cjs | 纯时间/源帧映射；整数PTS、呈现编号与源时间；播放取所在帧，交互用二分查找取最近帧，不改源身份 |
| plugin/playback-common.js | 原RAM账本、倍速、邻域规划和覆盖范围纯规则；供UI/native-player使用，不含旧JPEG播放类 |
| tests/、scripts/check.cjs | 隔离测试与统一检查；正式代码不依赖 prototypes，开发检查不进入产品 UI |

| plugin/media-policy.cjs、load-decisions.cjs | 纯格式/时长/体积策略与Session持有的可取消选择；不写媒体/Eagle，绑定任务代次 |
| plugin/proxy-storage.cjs | 整片代理独立预算、文件归属、读者租约、最近使用和安全淘汰；不碰原视频或标注 |
| docs/history/retired-monitor-e55/ | 退役监测源码，仅供开发回归；正式入口、打包及播放器不依赖它 |

## 媒体、音频与调度
- native-backend管理源身份/异步packet索引，native-reader/wire管理常驻原生进程、有界协议及关闭回执。重复/缺失PTS不猜测；定位/逐帧/标注基于实际源帧，旧代次不能覆盖。
- 原片先可播放，whole-proxy后台连续生产一份H.264全I，完整帧数/时间映射/尺寸/内容核验后原子发布并同帧接管；不随鼠标重启。CPU/NVENC保留原配方，奇数尺寸用偶数编码/SAR恢复；2160p由编码器选level，旧尺寸维持5.1。
- native-audio无损复制压缩音轨到有界stdout，逐包内容/PTS/DTS/有效边界/编码初始化核对；任务前后核对inspect的source.nativeStamp。源音轨边界仍严格；复制的AAC若以≤1024采样的整块时长代替相邻PTS间隔或超出已声明末尾，按相邻精确PTS/声明末尾规范化再与源指纹比较，差异计入内部回执，不重编码或改写源。其它编码/超界/内容或时间戳变化不豁免。零起点已验，其它形态保守回原声，源改变/取消不能静默回退。
- Player先为收集/合并/Blob峰值预留，音轨上限剩余额度1/3且≤32MiB，完成按实际字节×2计费；关闭卸载、撤销URL、释放预算。播放不等待audio.play承诺才启动绘图，静止时钟不抢跑；暂停复用有效音频游标，显式seek清旧续播归属。UI时间轴先经Session.loopFrameAt取得最近源帧，再以同一time/index画光标和seek；循环视图传入头尾ordinal边界，显式端点编辑仍用全范围。
- UI定位意图在播放时钟接管或准确暂停目标到达时交还，不依赖原seek Promise一定成功（续播可能已将它取代）；活动手势/未完成新目标仍保护。HTML先有准备文案，app先捕获选中素材，再经UI首绘边界初始化重模块；关闭取消首绘等待并等旧初始化退场，避免重开复活旧任务。容量确认期间仅隐藏次要进度文字，仍更新原提示寿命，不清错误或重置计时。
- 原生热帧单次通知/绘制，预算按kind增量统计。冷拖动最多一项在做和一项最新待办；重复目标复用，邻域预取/记录取帧的同reader、源、帧号和有效租约可提升为前台，共用原Promise及开始时间。提升后前台独占原预留，后台不得重复入账、释放或报告前台错误。非最终、相距≤0.2秒且在读帧位于实际帧到最新目标之间时，允许从原读者任务开始计算最多120ms的完成机会；替换待办不续期，到期调度最新目标，不再由上一次取帧≤32ms决定。120ms是事件循环上的抢占期限，不是解码/管道的硬响应上限；无待办的同帧请求仍按读者既有超时。远跳、反向越过在读帧、松手到不同目标立即抢占；同帧松手继续复用。已失效/被取消结果不能进RAM；同reader/源的有效完整旧结果可入缓存，仅方向正确的近邻结果可临时显示，仍保留pending/frameHeld，光标不回退、标注不能绑定它。播放可接续原生未完定位，暂停/新定位/关闭撤销续播意图，声音就绪后仍由音频时钟驱动画面。
- 暂停/热拖动同reader按最近方向3:1、实际源时间距离补邻域；近邻和记录缩略图各一个空闲槽轮换，前台随时抢占。最多4096邻域帧、受RAM/像素/在途额度限制；邻域后台不绘制、不无限重试。无鼠标静默等待、额外解码器或新的用户设置。wire先解析头，再为当前画面分配像素；过期/传到一半被取消的像素只排空不复制，控制消息和帧边界仍完整处理。旧JPEG仅开发回归保留原规则。

## 准备选择与取消
preview-profile统一720p～2160p几何/身份，原生桥像素边界支持UHD及竖屏；格式与阈值的单一参数入口见[能力表](releases/motionote-capabilities.md)。
media-policy只算策略，load-decisions一次一个选择并绑定请求ID/代次/AbortSignal，只有当前合法答复生效。换源/切模式/关闭使旧选择失效。
whole-proxy在同窗口完整复用核验后、写锁前确认累计预计超过1 GB的任务；实际超额停止/回收未完成文件，再确认重启。MP4族与Matroska族实际PTS分别取自原生读者，禁止用请求时间冒充回执。音轨边界从真实packet PTS/末包duration得出；MKV/WebM/PCM使用原文件HTMLAudio，其它仍优先已验证压缩音轨，复制边界不符时使用原文件；先确认音轨可读，不静默无声。

## 圈画生命周期
原生文字与本地图形没有跨存储原子事务。保存顺序为创建前读回、写入回执/结果核对、再提交本地图形；未知结果只读核对，不重复添加。任何部分失败保留草稿与已完成步骤，重试不重复写Eagle；保存/核对期间锁定编辑，不静默关闭。升级保留旧记录、关联和擦除字段，回退代码不撤销用户数据或保证旧版可识别新格式。
圈画格式及旧文件位置不变。drawing-store新增异步候选遍历（每批16目录，跨批游标轮转）与定点删除；只接收已校验scope/token，校验全部普通修订文件后从旧到新删除。写入和维护共用root内maintenance-<key>.lock；合法租约仅在所属PID已不存在时恢复，PID复用、部分写入/未知锁保留。中断保留最新完整修订供重试，空目录残留无用户内容；无法完成的维护记本机诊断，不伪装完成。
eagle.drawingDeletion唯一核对当前库API、普通images/<id>.info目录缺失、库根/images身份与根metadata可读；回收站目录存在即保留，不写库、不扫描视频。未知布局/响应/权限/切库返回未知。两次异步证明一致且当前素材未被保护时才允许store删除。app仅装配、触发与关闭失效；关闭无需等待迟到的只读探测，迟到结果不能删除或重新安排定时器。每轮合并触发，不进入播放/逐帧热路径。运行行为见[产品](product.md#圈画数据归属与删除)。
所有读写端：drawing-session经store.read/save/readVisibility/saveVisibility/readStyles/saveStyles；新维护经maintenanceCandidates/removeDeleted；app负责两者生命周期；eagle只读库状态；缓存/导出/原生媒体及旧包不成为圈画清理端。真实卸载由宿主目录管理，插件不伪造卸载事件。

## 缓存、持久化与退出
- 读者只有在真实关闭回执后才移出所有权集合；失败传播到Session/app，不能由allSettled吞掉。后端替换成功关闭旧实例后才清除旧引用。Player在读者失败时仍释放独立的JS帧/纹理/音轨，原生预留与所有权保留。用户显式再次关闭可重试残余释放，只等待原已派发标注写入，不重新派发。
- cache保留旧JPEG文件所有权、真实路径、锁和完整提交以安全迁移；proxy-storage管理本窗口代理资产/读者租约，正式temporary路径不靠跨次LRU复用。受管额度与OS/驱动进程占用不同。
- 原生单读者GOP约128～192MiB，接管预留第二读者；帧、缩略图、YUV/RGBA、绘制表面及在途纳入账本。管道/驱动边界与采样另报，不假称程序硬上限。
- whole-proxy失败先进入cleaning，等待受管进程停止，再核对realpath、owner token/pid、文件身份与白名单，只回收本任务未完成产物；确认后发布终态。失败保留锁及WHOLE_CLEANUP_FAILED，不把缺owner误当已清空；NVENC回退CPU前同样确认回收。
- 清理保护当前源所有画质、活动读写和未知文件；进程归属以出生/后代/独占访问证明，不凭PID消失或锁年龄删除。文件整理见[F规则](development-plan.md#文件整理f-01f-07)。
- Session等待实际取消、子进程/流/读者/租约/缓存收尾，宿主关闭请求不等同完成；未知结果/草稿保留。偏好、圈画和永久标注独立于可淘汰缓存；偏好原子保存、旧格式兼容和全部读写端见验证协议。

### 旧缓存后台维护兼容
这些边界只约束仍用于迁移/开发回归的旧cache/task链，不把旧JPEG播放方案恢复为正式前台。
- 后台负责人用规范插件路径对应的Windows互斥与任务组约束自有子进程，启动前建立归属；得到锁不等于旧任务组已退出。客户端核对任务key/epoch、进程身份及lease后才借读，不跨管道传图片。窗口断连/超时终止是异常结束，不冒充清理成功；不结束Eagle或其他应用，不因取消吞掉真实清理错误。
- 双槽/清理与恢复记录先落盘、读回校验，再按原计划操作；目录/文件身份以无损十进制字符串持久化。旧失真数值只能在已有归属/原计划摘要匹配的完成回执下只读核验，不能用于新删除或未完成恢复。恢复要求任务死亡证明、key/token/epoch、规范根、目录身份、owner/manifest及文件摘要全部相符；未知/被替换/链接/不完整记录保留，不能靠年龄或重新生成路径认定安全。
- 空writer锁只可在同一Windows独占句柄证明普通单链接、最终路径/卷/文件ID和零长度后写入并fsync完整归属；不接管未知非空锁。owner.next按原事务身份和受限快照恢复，不覆写原owner/manifest/资产；中断继续同一计划，旧固定名临时文件不猜测删除。
- 旧集中帧包借读按已登记范围、逐帧校验，批量读取及返回副本预记同一RAM账本，不整包加载；I/O/包流真实关闭后才回收。保留新旧布局读取/清理兼容，回退不认识新格式的代码不是无条件恢复。实际格式参数随对应模块维护，变更须覆盖全部读写与恢复端。

## 内部诊断与开发检查
startup-audit在页面早期记录有界启动时序；无本机E60限时配置时仅有限内存记录、不落盘。有配置时只写项目verification-runs/e60，最多10个文件、每份64KiB/160条，记录方法/数字/阶段，不采集视频或标注，不上传。配置不打包，期满停止；具体证据和停用条件见[E60报告](experiments/E60/report.md)。ui.prepareEntry绘制机会等待有250ms计时退出，仍不承诺线程阻塞时的实际墙钟时限。
用户监测窗口和设置入口已删除，app不再创建采样器或传递监测开关；按需订阅的diagnostics仍供开发定位问题。播放器资源账本、计时与安全护栏保留。退役源/迁移摘要见[监测归档](history/retired-monitor-e55/README.md)，历史测试只读该归档，不回接产品。
Session仅在释放成功后将SELECTION_EMPTY映射正常empty；SDK/释放故障保持error。

## 临时媒体与开发预览
- `temporary-media.cjs`为每个窗口建立`cache/sessions-v1/<随机id>`，登记owner/启动身份/子进程意图；全程生成路径局限其中。关闭开始即禁止新进程，2.5秒正常收尾后对仍活跃的原ChildProcess句柄发终止，5秒仍未收到close则报错保留；不按进程名称或裸PID终止。确认所有流关闭后才核验目录归属并原子改名为retiring后删除。未知文件/活动进程/不完整出生身份保留；迟到close后可明确重试。持久格式及恢复读者不变。无遗留时身份查询异步，不阻塞首帧；恢复旧会话才使用完整进程快照。
- `media-space.cjs`统一十进制1 GB累计确认、2 GiB物理余量、100 GiB内部保护与跨窗口原子预留；预留与输出字节上限都由生成层执行，UI不直接计数。`space.json`在任务终止后释放，崩溃由owner恢复处理。
- `legacy-media-cleanup.cjs`在正常关闭新运行链后异步预检目录项；只有成对历史回执及独立命名空间时不启动旧worker、不重验回执内容，原记录保持不动。真实旧媒体、未完成事务及未知项仍交旧cache所有权/读者检查；旧PID-only读者缺出生证据时保留。首次升级的旧媒体仍在正常关闭迁移，失败保留后端引用供重试；不新增持久迁移标记。原片、annotation-data、偏好和验收证据不进入删除白名单。
- app关闭等待当前Session/初始化/后端/子进程/临时目录及必要旧媒体清理；Eagle可能先显示尚未退出的旧窗口，UI因此保留持续说明与关闭按钮。run立即捕获并合并为最新请求，延迟hide完成后重新显示等待状态；安全关闭后再建UI。用户关闭取消排队，不让旧退出回调关掉新会话。限时诊断分别记录这些关闭阶段与旧维护子阶段，不等同宿主验收。
- `scripts/frontend-preview.cjs`仅开发使用：loopback随机令牌/Host-Origin/GET白名单；共享正式HTML/CSS/UI和Session，`scripts/preview`只替换播放器与Eagle/存储适配。示例写入sessionStorage，不进入产品包。原生窗控、GPU、缓存清理禁用；浏览器样本不能证明原生精度、音画、缓存或Eagle数据读写。

## JPEG开发保留与退休模块
| 模块 | 保留用途 |
| --- | --- |
| plugin/long-media.cjs | JPEG及历史分段共享实现（原生不调用分段链）；源帧索引、JPEG或全IDR AVC/PCM分段与源身份核对；120000帧/64MiB索引上限，持有同源batch、分段取消与统一关闭；音轨起点/两秒预热及audio-preroll-v2派生键 |
| plugin/avc-access-units.cjs | Annex-B流拆分、AUD/SPS/PPS/IDR框架与8MiB单帧保护；不负责证明完整H264语法或像素正确 |
| plugin/proxy-decoder.js | 常驻WebCodecs解码、两项在途、受控flush、ImageBitmap所有权及关闭等待；无文件或Eagle访问，硬件偏好不等于实测加速 |
| plugin/proxy-background.cjs | 前台优先的渐进代理准备、段描述/租约保留及writer账本额度判断；背景完整/容量停止先等batch核对关闭，不把整片图像常驻RAM |
| plugin/segment-reader.cjs、segment-audio.cjs | 受限分段读取/借用归还、共享时钟音频排程；关闭等待实际读取与释放 |

player.js、proxy-decoder.js、quick-preview.js、scrub-preview.js、record-previews.js退出正式HTML及NATIVE_RUNTIME，源码仍供旧回归使用；native-player/UI仅使用新playback-common，不为取几项工具加载旧播放器。其余共用模块仍支持旧缓存安全清理与开发回归，不能按文件名盲删。上表分段/AVC/WebCodecs实现仅供JPEG共享或历史追溯，不在当前原生代理前台链调用。旧性能dashboard/explainer/inbox/protocol/report/runner及标准测试脚本已退役，不进现行模块地图或发行清单；40份旧源码已保存在[历史归档](history/retired-performance-2026-10-31/README.md)，原位置文件按批准范围移除。
A-01～A-08、双槽记录/维护事务、关闭互斥与旧JPEG细节按任务查[原架构条款](history/2026-10-31/architecture.md#模块依赖与数据流)、[A-07生命周期](history/2026-10-31/architecture.md#a-07-任务生命周期与快速关闭交接2026-10-15-用户批准整改)、[A-08帧包](history/2026-10-31/architecture.md#a-08-jpeg集中存储与批量预载2026-10-16)。上述链接只追溯来源；现行边界由本页、产品与验证协议维护。发现可能漏迁的保护先核对补入现行规范，未决前保持既有保护；历史限额、实现路线和授权不自动恢复。
