# Motionote发布准备与资源边界调查

日期：2026-10-31。基线：E49冻结标签，运行代码503e0a6。本轮只读调查/文档登记，尚未开始修复或4K实现。

## 已明确与未定事项

- 用户暂定英文名称Motionote，发布前要求4K预览及完整素材/长稳验收；以覆盖Eagle视频格式为目标，不把目标写成当前能力。
- 本次插件发行不包含片段与画面导出。独立版、Eagle联动、扩展及新的代理格式未在本轮启动。
- 仍待产品取舍：JPEG退役与否、长片/大代理提示阈值、4K UHD与DCI/HDR/透明的具体承诺、更长视频与帧索引改造。
- 冻结标签不动；后续修复形成新候选。不得静默降画质、扩大缓存/验证预算或取消现有安全保护。

## 本轮事实与证据

1. `plugin/app.js`在播放器renderer创建performance-runtime。监测启用后每2.5秒采资源，磁盘统计间隔至少5秒；live-resources调用proxy-storage.usage遍历缓存。遍历中的regular逐文件执行lstatSync/realpathSync，目录内没有逐文件让出事件循环。
2. 当前plugin/cache根部2895个文件，其中2894个cleanup/reap回执；另有两个目录。独立Node v24.20.0只读调用现行usage一次，含末尾20ms计时等待的总时长216.9149ms，16ms计时器最大间隔193.7226ms，仅触发2次。证明有明显同步阻塞，不是实际Eagle/Chrome108卡顿测量，也不能解释监测关闭时的全部现象。
3. 本次读取得到总缓存202568595B，约0.1886567GiB；whole-v1两份同源完整代理分别53598104B、79145259B，1080p/1440p，时长均13.799625秒；未发现.pending目录。当前状态无法倒推截图时2.53GiB是否为失败残片。未读取或发送视频像素、未清理任何文件。
4. whole-proxy失败通知先于finally.cleanup；正常失败应清掉自己token/pid归属的临时目录，清理失败则另有cleanupComplete/cleanupMessage。clearOther只接受完整、身份有效、非当前源、非活动读者的代理。未知/未完成目录不在普通完整资产候选中，异常残留回收需要独立归属核验。
5. 性能面板diskTotal统计整个plugin/cache，包含原生代理、旧JPEG及回执；代理额度与JPEG额度分别管理。图2文案来自status=unchanged的无可清理结果，并非抛出的异常。现有文案没有解释哪些类型占用多少，用户难以判断。
6. 当前代理H.264全I，CPU ultrafast/CRF20或NVENC p1/固定QP20，4:2:0 8-bit、无目标码率控制；JPEG是MJPEG q3/yuvj420p，同为有损压缩。相同预览分辨率不代表同画质，两种参数不能数值横比。
7. 最高1440p分散在preview-profile、UI和whole-proxy；当前代理固定H.264 level5.1，需要结合4K实际帧率/设备能力核查。120000帧保护同时位于native索引、whole-proxy及JPEG；配合64MiB索引输出、6MiB控制JSON、准备超时，是现行整片索引/资源边界，不是Eagle的天然长度上限。

只读扫描复现命令（在仓库根目录，不生成媒体/记录、不清理）：

```powershell
node -e "const p=require('path');const{performance}=require('perf_hooks');const{usage}=require('./plugin/proxy-storage.cjs');let last=performance.now(),max=0,ticks=0;const timer=setInterval(()=>{const n=performance.now();max=Math.max(max,n-last);last=n;ticks++;},16);const start=performance.now();usage(p.resolve('plugin/cache')).then(bytes=>{setTimeout(()=>{clearInterval(timer);console.log(JSON.stringify({readOnly:true,node:process.version,bytes,GiB:bytes/1024**3,elapsedMs:performance.now()-start,maxTimerGapMs:max,ticks,scope:'separate Node process, not Eagle UI'}))},20)}).catch(e=>{clearInterval(timer);console.error(e.message);process.exitCode=1})"
```

原始stdout摘录：

```json
{"readOnly":true,"node":"v24.20.0","bytes":202568595,"GiB":0.18865670543164015,"elapsedMs":216.9149,"maxTimerGapMs":193.7226,"ticks":2,"scope":"separate Node process, not Eagle UI"}
```

2026-10-31后续用户实测反馈：确认性能监测窗口带来卡顿；缓存命中时，不开启监测目前感觉不到卡顿。这是用户体验对照，支持监测为本次触发条件，与上述同步扫描证据相符；不是Codex亲测或对所有视频/冷态/后台生成的无卡顿保证。下一步优先修监测并做修复前后开关对照，不再把窗口开关状态列为未知。全部有效需求的阶段划分见[需求总表](../roadmap.md#motionote需求总表与阶段顺序2026-10-31)。

## 建议实现边界（待执行）

### 卡顿

依据新增用户开关对照，优先修监测资源采样。磁盘统计改为增量/有界异步校准，保持身份安全检查；减少重复全目录扫描与频繁重算监测数据。修复后按监测开/关、后台生成开/停、同样RAM命中轨迹做Eagle复验，同时记录事件循环长任务和必要的GC/绘制。回执治理按F-01～F-07另列清单保留必要证据，不为消除症状直接清空目录。若仍存在停顿再扩查热帧绘制、GC和后台竞争，不扩大为未经验证的媒体架构重写。

### 4K

建议先明确2160p/UHD（3840×2160及竖屏对应）与不放大低分辨率源；DCI4096宽另列。尺寸档位、原生包与绘制、CPU/GPU编码能力与level、缓存账本/纹理、同帧接管、缩略图/圈画坐标均须检查。UHD像素量为1440p的2.25倍；8-bit YUV420约12.44MB/帧，RGBA约33.18MB/帧，只是像素负载，不是整个进程/显存。不能暗中提高默认RAM/磁盘额度或宣传4K60全设备流畅。HDR/透明不是提高尺寸即可保真。

### 容量不足与长视频

建议把当前任务明确分成生成、停止写入、回收临时文件、回收完成/失败；额度不足先停止并等待写入退出，删除已确认属于本任务的未完成文件，核实实际释放，再提示继续原片。进程退出后的残片只在所有权/源/目录/占用核实后处理；清理失败保留待回收状态而非成功，不删除未知文件。

开始前区分用户配置额度与物理磁盘可用空间，并给预计体积范围；实际增长继续校准，估算不是容量承诺。不够时先淘汰合格旧缓存；单片仍超额度则保持原片，提供提高额度/降低代理画质的明确选择，不反复从头生成。是否清理当前源已不用的旧画质副本须与“当前活动文件保护”分开确认，不能放开全部当前源删除。

JPEG超过2分钟的首次长等待提醒可采用“继续JPEG/改用代理”；加载中仍可切换。代理不应只按10分钟机械判断，短4K也可能很大：以预计体积、剩余额度为主，长片作补充。单片确认阈值尚未定；相同素材/配置不重复询问，用户拒绝仍正常播放原片。不要恢复常驻的手动整片生成/取消按钮。

120000帧现相当于24fps约83分20秒、30fps约66分40秒、60fps约33分20秒，VFR按实际帧数。正式说明、支持列表及打开前检查必须一致，不能承诺无限时长。解除保护需索引与协议有界化等验证，不能只删一个常量；新上限与普通播放降级策略尚未批准。

JPEG建议本次暂保留为兼容后备，先证明原生链路覆盖原功能再考虑退役；不能把JPEG宣传成无损/画质必优。两条链路都会增加测试维护成本，去留最终由用户决定。

## 验证与执行顺序

1. 阻断发布的热命中UI停顿、代理失败回收/容量说明；保留真实失败和前后证据。
2. 4K全链路及无损保存标注/帧定位验证，再扩容器和编码输入；不改变代理格式以混淆本轮归因。
3. 固定同一Eagle版本/平台的支持清单。每个声明容器至少首/中/尾播放、音轨、定位、重开冒烟；编码家族做性能，HDR/透明/10-bit/旋转/VFR/坏文件单列特殊项。历史出错源逐个复验，现有指定样本集做只读覆盖，缺样本登记而非编造通过。
4. 代表CPU/GPU、原片/已生成代理、冷/RAM命中与JPEG组合做深测；无需所有格式乘所有画质乘所有时长的全排列，也不只靠合成样本。所有代价/未支持形态在发布说明明确。
5. 建议两组不同素材各60分钟操作+5分钟静置、50次含UI/设置/草稿的开关组合；必须先固定隔离样本、目录/预算、停止线，原10分钟实验限额不自动扩张。标注写删限专用已授权测试素材；不在用户原库进行破坏性验证。
6. 以现行适用P-01～P-04为基准，实际Eagle与独立Node/浏览器分开。正确源帧/保存零错位、无崩溃/死锁、资源不持续累积、关闭无自有遗留、冷态与长尾明确；4K成绩单列，不能套用720p既有成绩。触及卡顿、缓存或4K的后续开发必须性能验证。
7. 最终打包后独立安装、升级/重开/保存检查通过再发布；说明只列已验能力，发布包包含许可和必要运行依赖。用户只集中评估真实手感/画质/声画，自动技术检查由Codex执行；不恢复用户标准测试/体验记录/report.html体系。

## 官方资料与适用范围

- [Eagle Build18–19播放升级](https://en.eagle.cool/blog/post/eagle4-build18)：MOV透明、ProRes、TS及其他格式；Eagle能播放不代表我们的独立原生链路自动继承支持。缩略图扩展支持也不能当作播放支持。
- [NVIDIA编码参数与能力](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html)：GOP、固定QP/码率与设备能力互有关联；不据官方示例吞吐推定本机性能。
- [Adobe代理创建](https://helpx.adobe.com/premiere/desktop/organize-media/ingest-proxy-workflow/create-proxies.html)：代理可以另选尺寸/预设；并非统一的“小于原文件”格式。

以上为2026-10-31核查的官方资料。本轮未下载素材或新依赖，没有新的媒体性能测试成绩。

## 文档影响与交接

已同步README、product、project-profile、development-plan、roadmap、verification和progress；E49报告仅附加冻结后的调查入口，不改原结果。architecture与性能WORKFLOW的现行实现/流程没有变化，不伪改；冻结发布记录、标签和历史实验保持。旧3个暂存探针及40个未跟踪退休文件不混本轮，不声称工作区干净。适用检查与提交情况在progress登记。
