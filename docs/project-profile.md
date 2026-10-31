# 项目说明

2026-10-31 发布准备：E-49 运行代码仍冻结；用户暂定品牌Motionote，要求发布前支持4K并补齐素材/长稳验收。当前只登记需求、调查缓存扫描阻塞和资源边界；JPEG去留、容量提示阈值与解除帧数上限仍待决定，未实施。见[发布准备与调查](releases/motionote-preflight.md)。

当前：E-49 已按用户要求于2026-10-30冻结，标签 `e49-frozen-2026-10-30`；运行代码固定503e0a6，只补文档。独立原声与续播修复的本地/真实音频浏览器检查通过，Eagle手感仍待验；不自动继续开发。见[冻结记录](releases/e49-frozen-2026-10-30.md)及[阶段记录](experiments/E49/report.md)。下方E48及更早为历史。

当前：E-48 已补齐热拖动/暂停提前解压并统一清缓存按钮；本地回归及真实解码联通检查通过，Eagle手感待验。代理暂不调整；已撤下时间轴聚焦蓝框。见[本轮记录](experiments/E48/report.md)。E47及更早为历史。

当前：E-47 排查RAM命中拖动卡顿，调整按帧拖动速度，撤下JPEG重复应用提示；适用本地检查通过，初始间歇卡顿未稳定复现。见[计划](experiments/E47/plan.md)。E46及更早为历史。

历史E-46： 按九项反馈修复播放响应、代理尺寸、逐帧拖动及设置/提示；适用本地检查及实际源几何/PTS检查通过，Eagle手感待验。见[本轮计划](experiments/E46/plan.md)。E45及更早为历史。

历史E-45： 已实现高画质原片取帧修复、代理磁盘额度和旧代理淘汰、即时监测与资源读数；记录/标测/代理条撤下。适用本地检查通过，真实Eagle高画质体验未验；旧文件清理因工具策略拒绝尚未执行。见[本轮记录](experiments/E45/report.md)。E44及更早段落为历史，冲突项以E45为准。

历史E-44：原生体验版已接入正式plugin，真实Eagle正式媒体模块完成三轮固定轨迹。完整UI/全部素材/长稳未最终验收。[体验与证据](experiments/E44/experience.md) · [阶段记录](experiments/E44/report.md) · 旧图表（已停用）。冻结Beta不改；HEAD43b0f4及不提交例外保持。

## 当前模块与资源边界

原片/完整代理统一FilmCraft原生读者，异步packet源索引/整数PTS，后台独立整片H.264全I生成，完成验证才同帧接管。前台不运行旧分段/稀疏预览；JPEG独立旧整片准备。native-backend/reader/wire管理媒体与进程，native-player/renderer管理源音频时钟、RAM、YUV/WebGL及CPU回退，whole-proxy管理完整生产/发布/取消；proxy-storage管理代理额度及读者租约；live-resources和performance-runtime管理即时监测。设置与现有UI沿原session接线。E46新增统一GPU加速；代理自动生成与提前解压固定开启；其它缓存维护走后台，提示统一左下。E49以native-audio无损复制压缩音轨到有界内存，避免取声路径同时恢复原4K视频；Player管理Blob/预算和音频时钟，代理保持不变。E47减少热帧/账本/布局冗余，横拖按短长范围一次计算灵敏度，JPEG应用时仅显示实际进度。E48在目标已就绪时补原生单读者邻域填充，JPEG热拖动豁免静默期；冷目标前台优先，清缓存按钮与应用统一。

原生GOP单读者128～192MiB，接管另预留第二读者；YUV/RGBA、缩略图与表面纳入管理额度，非整个OS/驱动硬上限。E45整片代理额度默认5GiB、可选1～100GiB，按最近使用时间自动淘汰未占用的旧源代理；JPEG保留5GiB。身份不明/当前源/活动读者保护，单片超过额度继续原片。完整代理只在完整核验后接管，代理条已删除。等待保留上帧并用frameHeld保护标注；核验按阶段帧数/字节显示，硬解关闭时不用GPU核验。工具8GiB/验证2GiB/单轮10分钟不扩大。

## 身份与入口

- 正式主线是Eagle Window视频分析插件，唯一实现位于 `plugin/`；开发入口 `plugin/manifest.json`，界面名“视频分析”。
- 当前开发版支持MP4及720p/1080p/1440p预览，设置高级菜单可选代理或JPEG序列，以统一GPU加速控制编码/解码/绘制，缺少旧偏好字段时默认proxy；原生代理使用独立整片路径，JPEG所有时长沿旧整片准备路径。源帧上限120000、索引64MiB/控制JSON6MiB，重复/缺失PTS不猜测。默认720p/1GiB，提供512MiB及1～10GiB档位；压缩帧池≤总额度1/8。额度不是整个程序内存硬上限，1440p与真实长片性能仍需实际体验。
- 已发布MVP Beta2/R4已归档；冻结的是发行包、标签与仓库外安装，不表示后续开发停止。发行入口名“视频分析 · MVP Beta”、独立ID，功能固定720p；历史路径公开已接受，许可证未指定。
- Git根为 `eagle-video-analysis/`，保留单一仓库。原型A/B/S1及preview-quality受局部AGENTS约束，默认封存；旧T2/T4自动测量入口停用。
- 技术栈：HTML/CSS/JavaScript、Eagle API、FilmCraft原生媒体桥、YUV/WebGL或CPU绘制、源音频HTMLMediaElement，Node内置模块和Eagle现有FFmpeg/ffprobe；JPEG保留Canvas/Web Audio/旧任务守护。Rust仅开发构建依赖。
- 实际已测Eagle为Node16.17.1/Chrome108，开发默认检查用Node24；命令行兼容、独立Chrome、本地媒体、真实Eagle和用户体验分别记录。

## 资料位置

| 内容 | 位置与职责 |
| --- | --- |
| 长期权限和工程规则 | 根AGENTS.md；不堆进度 |
| 产品、架构 | docs/product.md的R/P及批准补充；docs/architecture.md的C/A-01～A-08 |
| 愿景与未来候选 | docs/roadmap.md；EV决定、近期/中期/远期及调整理由，不是已实现功能 |
| 任务、清理规则 | docs/development-plan.md；E45修复/清理与未验关卡、历史T/E任务及F-01～F-07 |
| 验证协议 | docs/verification.md；协议、真实运行和人工反馈分开 |
| 当前状态 | docs/progress.md；先读顶部当前交接，后段为历史 |
| 专项结果 | docs/experiments/E49/report.md当前冻结代码的修复/验证/缺口，E48及更早按历史范围保留 |
| 发布交接 | docs/releases/e49-frozen-2026-10-30.md当前源码冻结；docs/releases/v0.1.0-beta.2.md为旧安装包发布记录 |
| 旧发行与过程 | docs/releases/旧版本、docs/progress/、demos/standalone-preview/；历史说明不冒充下载或新授权 |
| 私人原始证据/配置 | verification-runs/和原型evidence/等Git忽略路径；不公开、不覆盖 |

## 运行与检查

- 当前本地入口：node scripts/check.cjs --without-prepared-host。检查语法、边界、纯/模拟测试、manifest和文档；不处理真实媒体、清共享缓存或写素材库。参数只排除已停用旧T2准备入口，不豁免正式代码检查。
- 原生体验运行清单只读验证：node scripts/package-release.cjs native-experience；约29.29MiB，含EXE及许可闭包，不生成ZIP。原生构建见native/filmcraft/README.md。
- Windows守护源码变更或新检出时，由Codex用node scripts/build-task-host.cjs构建并核对本机指纹，再提供可运行包；用户不需安装Node或输入命令。
- Beta2打包器：node scripts/package-release.cjs build、verify、extract、verify-install分别显式执行。build要求干净来源、不覆盖旧输出；21运行文件＋README/CHANGELOG/BUILD-INFO，目录和ZIP各≤2MiB。verify/verify-install依赖尚存在的构建/独立目录；清理后只可按保全回执核对ZIP，复跑需明确重建来源，不能假设旧目录仍存在。
- 已人工验证包来源9e2fd0d，ZIP SHA256及验收见发布记录；不因文档更新覆盖此包。BUILD-INFO内布尔值是构建时状态，后续用户人工结果记录在报告，不改冻结包冒充构建时已验收。
- scripts/audit-publication.cjs只读扫描当前内容和待推历史，报警不代表删除许可；旧提交路径与当前包隐私分开。历史路径公开已由用户接受；2026-10-30用户授权推送本次冻结标签，具体范围见冻结记录。
- 技术计量/命令由Codex执行。正常产品页面无测试按钮；不重跑认可拖动体验或专门一小时测量，不以后台/模型通过冒充Eagle窗口操作。
- 具体历史媒体/关窗/计量工具及副作用见各实验计划/报告，须按具体范围显式调用，不从旧命令中自动恢复已消费授权。

### 历史原型命令及副作用

A/B的check.cjs、check-b.cjs、assess-b.cjs --verify-only及S1的check-local/check-prepare/check-selected仅用于对应封存范围；带reset、媒体生成或删除的命令先读局部AGENTS和原计划，不为文档同步重跑实验。旧测量配置和原始证据保留，不能借Git回退恢复已消费的标注写入授权。

## 版本与证据

- 既有poc-a-verified、poc-b-performance-verified、phase3c-approved、T1体验/早期技术、T3及生命周期体验标签保留，各自只是限定节点，不是所有R/P通过。
- 标签固定源码；原始证据另存有界本机记录，用户反馈明确标注来源，不假称Codex亲测。
- 当前v0.1.0-beta.2标签指向包来源9e2fd0d，冻结；main继续正式开发。UI01～UI05/E19～E30积累已在7f4b544补录，E31独立提交，不伪造旧阶段逐轮提交。
- 正式磁盘缓存5GiB，实际插件根下cache，与安装同盘且非C盘。运行缓存1天未用及容量淘汰，与开发生成物清理分开；不能以文件年龄删除写锁。
- 发行本地清理记录固定verification-runs/release-0.1.0-beta.2，总1MiB/单份128KiB/最多16文件；不挤占或扩大原T4等配额，不进包、不入Git。

## 当前工作区与正式文件边界

正式开发只维护plugin/这一套播放器；native/filmcraft保留原生桥源码/构建与上游许可，运行只依赖plugin/bin，不依赖开发工具。下列正式模块已经存在，模块存在不代表T2/T4全部验收完成；原型和发行副本不作为第二套开发主线。

| 主要目录/文件 | 通俗说明 |
| --- | --- |
| plugin/ | 真正继续开发的插件；改播放器功能从这里开始。cache/是自动生成的视频预览，memory-settings.json是本机记住的内存选择，不是源码 |
| tests/ | 检查功能与安全边界的测试。host/window/和host/t4/是停用的历史Eagle测试入口，不重新导入。host/t0/保留早期测试，host/t2/cache-scratch/只放可清理的小测试现场 |
| scripts/ | 开发者使用的检查、准备测试入口、核对记录和打包命令；用户日常播放不需要手工运行 |
| docs/ | 产品要求、架构、开发任务、进度及验收报告；product说“需要什么”，architecture说“怎样分工”，development-plan说“按什么顺序做”，progress说“做到哪一步” |
| verification-runs/ | 测试产生的原始记录及核对回执，相当于验收凭据；被Git忽略仍需有界保留，不能当普通垃圾清空 |
| prototypes/ | A/B与S1的早期实验，保留探索过程和必要证据；正式插件不依赖它们 |
| demos/standalone-preview/ | 临时独立版的装配方法、说明和证据；work/中的软件零件用于重建冻结版，不用于插件日常运行 |
| dist/ | 仅构建/验收暂存；发布核对后只留最新ZIP/校验，日常安装迁出仓库，正在注册使用的目录先保护 |
| AGENTS.md、README.md、.gitignore、.git/ | 分别是长期工作约束、项目使用入口、不提交的文件名单、Git版本历史；忽略名单不负责自动清理，也不代表删除授权 |

工作协作可理解为：app接线 → ui接收鼠标/键盘 → session调度当前视频 → eagle读素材/标注、media准备、cache管文件 → player显示画面和声音。frame-index负责“这个时间是哪一帧”，preferences负责记住内存、画质与交互设置。以下列出现行与JPEG保留模块；旧分段/WebCodecs/稀疏模块不在当前原生proxy链运行，存在不代表仍启用。详细边界如下。

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
| plugin/graphite-shell.js、graphite.css、interface-icons.js | 视频优先布局、直角透明材质、图标、左工具/右记录、缩略图租约和标注输入位置；不访问素材库 |
| plugin/performance-explainer.cjs、performance-dashboard.cjs | 当前等待的通俗解释与离线历史对比/覆盖矩阵/图表导出，不控制播放 |
| plugin/performance-protocol.cjs、scripts/run-standard-performance.cjs | 固定条件、准备状态、独立同源测试配置；不自动接受性能基准 |
| plugin/settings-view.js | 原设置控件的分级展示；子菜单中心跟随父项并在视口边缘限位，保留原应用/即时生效写入端 |
| plugin/timeline-strip.js | 灰色带、蓝光标、白标注、内嵌片段、真实帧刻度；E39增加代理淡蓝条；E44仅完整校验后显示整片范围 |
| plugin/window-drag.cjs | 宿主窗口恢复和拖动调度，不改播放核心 |
| plugin/loop-selection.js | UI层短/长按与端点草稿，只通过Session预览/确认；无文件、缓存或Eagle API访问 |
| plugin/timeline-view.js | UI纯显示映射：整段/循环片段范围、自适应刻度、时间坐标及绿条/标注裁切；不解码或分配视频缓存 |
| plugin/drawing-model.js、drawing-erase.js、drawing-ui.js | 绘图对象/擦除覆盖/淡化计算及SVG显示、文字编辑；通过Session发操作，不直接访问Eagle或媒体缓存 |
| plugin/drawing-session.cjs、drawing-store.cjs、annotation-data/ | 同帧关联、草稿与永久图形/文字/样式存储；独立于会淘汰的预览缓存 |
| plugin/screen-gestures.js、screen-gesture-ui.js | 纯手势识别、指针/时钟和反馈展示；通过原Session定位/调速，不接入媒体解码 |
| plugin/context-wheel.js | 观看/圈画右键方向选择、单次打开预建并复用类型/颜色外圈、悬停取消及销毁；通过UI调用既有操作，无媒体或Eagle访问 |
| plugin/preview-profile.cjs | 720p/1080p/1440p预览尺寸与身份；共用原缓存预算，不放大小源 |
| plugin/session.cjs | 素材/库快照、状态与任务所有权，协调适配、准备、缓存和播放 |
| plugin/eagle.cjs | 唯一素材/标注 API 边界；独立读回，不直接写 metadata.json |
| plugin/export.cjs、export-work/ | 源视频图片/片段导出、本次暂存及本地保存；由既有后台任务执行，暂存累计1GiB、正常结束清本次，异常/导入未知保留核对，不受预览缓存清理器删除 |
| plugin/media.cjs | 只读源媒体、分析和 FFmpeg；转发proxyBudget/closeProxyBatch，通过缓存句柄受限写入，不自行淘汰目录 |
| plugin/long-media.cjs | JPEG及历史分段共享实现（原生不调用分段链）；源帧索引、JPEG或全IDR AVC/PCM分段与源身份核对；120000帧/64MiB索引上限，持有同源batch、分段取消与统一关闭；音轨起点/两秒预热及audio-preroll-v2派生键 |
| plugin/avc-access-units.cjs | Annex-B流拆分、AUD/SPS/PPS/IDR框架与8MiB单帧保护；不负责证明完整H264语法或像素正确 |
| plugin/proxy-decoder.js | 常驻WebCodecs解码、两项在途、受控flush、ImageBitmap所有权及关闭等待；无文件或Eagle访问，硬件偏好不等于实测加速 |
| plugin/proxy-background.cjs | 前台优先的渐进代理准备、段描述/租约保留及writer账本额度判断；背景完整/容量停止先等batch核对关闭，不把整片图像常驻RAM |
| plugin/media-wire.cjs | 整数PTS/共同时间基准/显式结束时间的紧凑控制协议，≤6MiB/120000帧、摘要/版本检查及无损重建；不读素材或改源SHA |
| plugin/segment-reader.cjs、segment-audio.cjs | 受限分段读取/借用归还、共享时钟音频排程；关闭等待实际读取与释放 |
| plugin/cache.cjs | 文件所有权、路径、预算、锁、完整提交、淘汰与清理；openBatch/beginSegment/snapshot/close、双槽目标记录、失败退款与原计划恢复；完整manifest备忘仍每次SHA核对字节，不备忘可变归属记录，不操作UI或素材元数据 |
| plugin/preferences.cjs | RAM档位/物理上限、画质、JPEG/代理方式与交互偏好、旧格式只读兼容和本地原子保存；不访问素材库或清理媒体缓存 |
| plugin/process-identity.cjs | Windows进程出生/后代只读证明；独占句柄核对后接管空writer记录；未知时保留，不终止进程、不调用Eagle API |
| plugin/task-client.cjs、task-worker.cjs、native/task-host.cs | 窗口与后台请求、按回执合并最新位置/记录意图、Windows互斥与任务组；worker单队列处理同源抢占及维护/换源/关闭时batch收尾，客户端原租约借读；控制消息不传图片，历史基础见A-07 |
| plugin/frame-pack.cjs | 校验集中JPEG/AVC帧包的纯布局及videoEncoding；物理文件读写仍归cache |
| plugin/frame-index.cjs | 纯时间/源帧映射；整数 PTS、呈现编号与源时间关系 |
| plugin/player.js | JPEG及历史播放器；当前proxy模式使用native-player。Canvas、Web Audio、旧代理解码注入与调度；通过缓存读取/预算句柄取得资源，不调用标注API |
| tests/、scripts/check.cjs | 隔离测试与统一检查；正式代码不依赖 prototypes，开发检查不进入产品 UI |

### 工作区整理入口

统一规则见[开发计划F机制](development-plan.md#发行产物统一整理f-01f-05f-06f-072026-10-16-用户批准)。此前两次发行整理累计清理278文件、975407862B（约930.22MiB），见[发布整理记录](releases/v0.1.0-beta.2.md#工作区整理与文档一致性2026-10-16)；2026-10-18本轮另清5份旧演示测试副本及空目录，74974B，当时汇总及保留项见[历史进度](progress.md#当前主线文档同步与残留整理2026-10-18)。dist仍仅最新ZIP/校验共104994B。日常安装路径由用户指定，实际路径只记本机清理回执，不写进公开包。用户已确认仓库外新位置载入正常，旧安装/构建目录已退役；verify和verify-install所需暂存目录已不存在，不要直接重跑，复核发行用ZIP/远程摘要及保全回执。冻结原型、原始证据及工具链不随dist整理删除。

## 开发收尾检查

默认检查包含现行文档阶段一致性；提交前运行 `node scripts/check-handoff.cjs --base HEAD`，提交后运行 `node scripts/check-handoff.cjs --require-clean`。本地提交不代表宿主验收或发行，不能因应用没有变更按钮而跳过Git核对。
