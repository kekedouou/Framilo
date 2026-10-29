# 代理方案复核与代价

2026-10-29。研究建议，未采用新格式；本机未进行本轮新格式编码计时，不承诺倍率。现行范围见[计划](plan.md)。

用户随后明确“关于代理，目前就先不做调整”。以下仅保留研究依据，不作为下一轮自动执行的授权。

## 当前真正做了什么

whole-proxy.cjs的配方已是完整H.264/MP4全I（g=1、bf=0），每帧独立；CPU为ultrafast/CRF20，NVIDIA为p1/constQP20。它并非普通长GOP视频。GPU配方仍先CPU解原片、CPU scale/format，然后交NVENC编码；播放硬解又需要读回CPU，经管道交UI并上传WebGL，并非GPU表面直接显示。

native-player的RAM命中分支跳过文件/解码器直接提交像素；这一段换代理格式不会更快。原片已命中RAM、原片GOP较短、或传输/绘制/调度占大头时，代理前后体感差距可能很小。这是代码路径与性能分项推论，不是已定位用户所有卡顿的结论。

## 候选

| 方案 | 预期作用 | 代价与限制 | 优先度 |
| --- | --- | --- | --- |
| 保留H.264全I，GPU解原片→GPU缩放→NVENC | 避免转码时CPU缩放及主机/显存往返，主要缩短生成等待 | 源格式、色彩、SAR、PTS、驱动和FFmpeg兼容需核；不直接改善生成完成后的RAM复访 | 优先隔离比较 |
| MJPEG | 独立JPEG、软件解码简单，可比较随机冷跳 | 锁定FilmCraft直接输出RGBA，当前桥会走CPU转换/4字节像素；同分辨率传输与缓存可达YUV420的2.67倍，不能只替换编码名 | 次选对照 |
| ProRes Proxy / DNxHR LB | 帧内剪辑格式，可并行解码，适合与原片比较 | 当前Windows FilmCraft硬解工厂不支持；422/10位等输出绕开当前8位420快路径，需CPU转换；文件更大或更小取决于实际配方，不保证比当前H.264快 | 后备 |
| GPU表面直接呈现，减少CPU读回与再次上传 | 针对代理就绪后的逐帧数据搬运，而非仅缩短生成 | 需要改变Eagle/原生桥之间的绘制架构，增加平台、驱动与关闭/标注映射验证；不属于换格式小修 | 仅在计量证实搬运为主因后另议 |

NVIDIA官方推荐保持解码/缩放/编码在GPU侧，且区分独立编解码吞吐和完整流水线速度：[FFmpeg GPU指南](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html)。本机只读确认Eagle现有FFmpeg6.1有cuda、scale_cuda、colorspace_cuda及h264_nvenc，无需据此先安装新依赖；有滤镜不等于所有源均兼容，证据verification-runs/e48/ffmpeg-capabilities.json。

锁定源码：[Windows硬解工厂](https://github.com/storytold/filmcraft/blob/176e6a9c585fd29e4b18d691663fe88a936c5b37/crates/platform/src/lib.rs)、[各格式软件解码输出](https://github.com/storytold/filmcraft/blob/176e6a9c585fd29e4b18d691663fe88a936c5b37/crates/codecs/src/video.rs)、[MFT读回](https://github.com/storytold/filmcraft/blob/176e6a9c585fd29e4b18d691663fe88a936c5b37/crates/platform/src/media_foundation.rs)。本地bridge.rs只对8位420及支持色彩走YUV快传，其它需转换RGBA。这里的限制指当前锁定实现，不代表这些格式在所有硬件/软件中都无法加速。

## 容量账

以下按1080p、约30fps、无音频/封装少量开销估算，MB为十进制，MiB/GiB为二进制。各格式不同压缩损失，不能把同名“代理”档当作等画质。

| 格式/条件 | 每分钟磁盘 | 依据 |
| --- | --- | --- |
| 当前H.264 CRF20/QP20 | 内容相关，无固定数值 | 不是固定码率；火花、噪点、运动和CPU/GPU编码器都会改变大小 |
| ProRes Proxy | 约338MB | Apple目标45Mb/s，1080p29.97 |
| ProRes LT | 约765MB | Apple目标102Mb/s，1080p29.97，质量档更高 |
| DNxHR LB | 约339MB | Avid每帧188,416字节×29.97×60 |
| DNxHR SQ | 约1.08GB | 每帧602,112字节×29.97×60 |
| MJPEG算式示例 | 约176～879MiB | 假设实测平均100～500KiB/帧×30×60；仅算式，不是画质/大小保证 |

来源：[Apple ProRes白皮书](https://www.apple.com/final-cut-pro/docs/Apple_ProRes.pdf)、[Avid DNxHR带宽表](https://kb.avid.com/pkb/articles/en_US/Knowledge/DNxHR-Codec-Bandwidth-Specifications)。官方目标/实现性能不能直接套为当前Rust解码器的测速结果。

解码后RAM由像素格式决定：1080p8位YUV420约2.97MiB/帧，RGBA约7.91MiB/帧；整分钟30fps约5.21GiB/13.90GiB，另有解码器和绘制表面。将磁盘压缩得更小不会按比例减少这些RAM。宽高各减半可把像素、帧RAM和传输量降到约1/4，但损失火花/烟雾细节，不能静默采用。Open RV同样建议有界前读，并权衡简单解码、更大文件和磁盘速度：[性能指南](https://aswf-openrv.readthedocs.io/en/stable/rv-manuals/rv-user-manual/rv-user-manual-chapter-fourteen.html)。

## 建议下一步

先验收本轮自动提前解压；随后同源同分辨率分开测原片/完整代理冷跳和RAM复访，保留源PTS与当前画质。若瓶颈是生成，优先试完整GPU转码链；若是就绪后冷跳，先对比当前全I的CPU/硬解完整请求，再小量比较MJPEG/ProRes Proxy；若命中RAM仍慢，查提交与搬运。不能拿单一解码FPS作为整条链的结论，也不恢复已撤下的产品标测/report系统。
