# E42 本轮实施与验证（2026-10-27）

本轮已落地预览身份/回调竞态修复、提早关窗及停止准备、AVC包扫描优化、固定冷区自动对照与报告。**没有达到冷区准确帧等待减半或低清P95≤200ms；GPU仍慢于CPU。**没有替换生产器架构、改变编码画质或接受基准。关联R-02/R-03/R-08、P-01～P-04。

## 实际改动

- quick-preview：松手时按源帧区间定位，提前注册实际画面回调；仅同源PTS允许最终补位。currentTime、邻近缓存和旧拖动结果不再作为最终帧证据。回调先于seeked、readyState仍为1时保留确认结果，待可绘制后使用。当前最终目标的可选原生预览等待最多3秒，移动仍最多1.5秒、新输入80ms后可重定向，准确画面一到立即取消；**没有延长代理解码器2秒超时**。
- app/task-client/task-worker：草稿保护通过后调用Eagle窗口hide；监测收尾与session回收重叠。新增不释放租约的quiesce控制，立即取消后台生产/未完成记录读取；读者与借用归还后才能真正关闭。重开等待旧关闭与hide结果，清理失败重新显示错误，不报告成功。关闭后的可见消失和后台退出分别验证。
- avc-access-units：用Node原生Buffer搜索代替逐字节JS扫描；四/三字节起始码、边界拆分、8MiB上限及输出字节不变。没有改画质以换速度。
- run-cold-performance：固定同一视频SHA/工具SHA、720p、10GiB额度和轨迹，分别记录未代理位置、磁盘已有代理、RAM已有图、快速拖动松手。支持CPU/GPU顺序自动运行，成功成对后自动更新report入口。当前明确调用一次，不是后台定时任务。

## 同源前后数据

源为用户最新体验的4K H.264、77.461333秒、4642帧；只读原件SHA `36fb269b755ba433fd248dc2f297ace583e92385cf9cd5806e96abe75468784b`。每种配置2轮、每轮3次冷跳转；P95为小样本最近秩，不能当统计显著。

| 指标 | CPU 前 → 本轮 | GPU 前 → 本轮 |
| --- | --- | --- |
| 冷区准确帧P50 | 1977 → 1860ms | 2805 → 2707ms |
| 冷区准确帧P95 | 2109 → 2172ms | 3435 → 3157ms |
| 冷区有低清补位 | 6/6 → 6/6 | 0/6 → 6/6 |
| 本轮低清P95 | 1354ms | 2876ms |
| 最终预览PTS偏差最大值 | 13 → 0ms | 原无补位 → 0ms |
| 磁盘已有代理P95 | 48.5 → 28.7ms | 56.2 → 41.8ms |
| RAM已有解码帧P95 | 7.1 → 7.2ms | 7.4 → 7.1ms |
| 快拖松手准确帧等待最大值（2次） | 1806 → 1323ms | 2653 → 2245ms |

正式播放器/原生guard/FFmpeg/WebCodecs在独立Chrome运行；未测Eagle窗口、音画或物理显示。原始文件后台包含音频准备，但浏览器不播放音轨。源/编码配方/轨迹固定，OS缓存和整机负载不保证固定。最终低清验证的是呈现PTS，不冒充条码像素同帧验收。CPU尾部略变差，不能声称全路径提速。

证据：`verification-runs/e42/browser-{cpu,gpu}-before.json`、`browser-{cpu,gpu}-verified.json`、`summary-verified.json`；后两轮运行代码哈希相同为`9dc0bcf8f8d0d293252800850fa030c50e4d1aac99e1e72ec69275edd855cf22`。修改前64个运行文件封存于source-before；原始before文件当时未嵌入代码哈希，来源由该快照保全，不能补写旧原件。

[用户对比图](../../../artifacts/performance/e42-comparison.html)已接回[报告总入口](../../../artifacts/performance/report.html)。不会把独立实验混入Eagle有效标准记录；先前有效记录未删除/覆盖。

## GPU瓶颈与未采纳试探

在同一43.99秒起点、120帧、视频单轨的独立FFmpeg试探中，现有GPU配方首次输出需约1322～1398ms、全段约1952～2026ms；这包含初始化、寻帧和首图处理，**不是纯GPU编码耗时**。输出约26.6MB。限制120帧输出和输入解码线程改1的结果均与原配方SHA相同，但总耗时约1907～1957ms，收益小、样本少，未改正式参数。证据producer-probe.json。音频、缓存提交、原生预览竞争不包含在此试探内。

前台最新目标抢占此前已存在；本轮复核target会取消不同段后台任务、读者会取消不同段的未完成请求，没有重复加另一套队列。固定单次冷跳转的主要等待仍是整段准备，不是显示端十几毫秒解码。对用户体验中双槽排队的长尾，还需要高频真实宿主复验，不能以三次冷跳转认定消除。

下一技术关应是**复用生成端上下文、尽早交付已校验的目标帧**，并单独解决原片低清解码慢/争用；不能继续靠加大超时或改线程数声称解决。常驻可寻址生产器尚未实现，涉及取消、逐帧发布、租约与资源恢复，仍须独立原型及准确性/关闭关通过后接入；本轮没有把“常驻播放解码器”冒充该能力。参照[NVIDIA FFmpeg说明](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html)理解初始化摊销，官方说明不代替本机收益证据。

## 检查、整理与边界

- 默认检查通过（无生成媒体、无历史实验重跑）；新增最终同帧、回调先于seeked、取消生产不释放借用、隐藏/失败再显示/重开回归。
- Eagle内置Node16运行quick-preview、avc-access-units、t1-app、task-read-priority、proxy-decoder五套检查通过；这不是Eagle GUI验收。
- 另在真实Windows guard中启动同源GPU冷段读取，250ms后beginClose：读取返回MEDIA_CANCELLED，约88ms完成真实源释放/负责人退出，同一路径重新ping/关闭成功，没有partial或writer.lock残留。自有目录按SHA核对清理，回执close-active.json。该88ms不含Eagle窗口/监测UI，也不是关窗≤200ms验收。
- report在独立Chrome验证1280/640宽度无外溢、总入口链接、PNG/SVG导出，并查看截图；证据report-check.json/report.png。
- 自动实验生成物和浏览器资料约1.175GiB，低于E42累计2GiB；逐轮核对自有绝对路径、非链接、身份/字节/SHA后删除，清单在各JSON cleanup和report-cleanup.json。保留有界日志、原始计量和source-before；未删正式缓存/原视频/标注/旧有效报告。
- 运行中迭代after/final记录保留用于定位“回调已到但不可绘制”及GPU超过旧预览期限；最终图只选择verified闭环，不挑最快一轮。
- 真实Eagle关窗观感、低清切回像素、4K以外/长时稳定性仍未验收。没有声称关闭≤200ms或冷区达标。
- 沿E38～E41本轮不提交约定，不提交/推送。HEAD仍43b0f41，既有大量未提交工作和三份已暂存探针保留；不宣称工作区干净。
- `check-handoff --base HEAD`与`git diff --check`通过；现存工作区包括本轮及E38～E41积累，三份暂存探针清单未改。不运行或宣称require-clean通过。

## 文档影响与复盘

README、project-profile、progress、product、architecture、development-plan、roadmap、verification及性能WORKFLOW更新当前行为/事实/恢复入口。E41与更早实验、已发布版本冻结；不批量改历史日期。源数据格式、偏好、正式缓存清理规则未改。

可复用：修改前同源自动对照、闭环后报告、失败可见而非隐藏清理结果。修正：把currentTime当像素身份、过早消耗回调、把缺少补位算成快速都不成立。仍未解决的生成端速度不能包装为成功流程。
