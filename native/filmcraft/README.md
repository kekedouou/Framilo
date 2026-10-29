# FilmCraft 原生媒体桥

维护入口，不是另一套播放器。运行文件为 plugin/bin/filmcraft-media.exe；它不读取 prototypes、上游源码、Rust、Q:或 verification-runs。仅开发构建使用既有隔离工具。

来源固定：storytold/filmcraft 0.13.0，commit 176e6a9c585fd29e4b18d691663fe88a936c5b37，MIT OR Apache-2.0。原始ZIP SHA256为 a025662645f6d330103eaea389c57ce9418a014167bc446ba5ae46fc470f44fb。没有打包编辑器UI、品牌或字体。直接复用 media/codecs/platform/frame，包括Windows Media Foundation/D3D11硬解及上游软件回退。

## 进程与协议

命令行：

```text
filmcraft-media.exe <source-path> <hardware|software> <720|1080|1440> <cache-bytes> [output-width output-height [yuv420p|rgba]]
```

cache-bytes为134217728～402653184（128～384MiB）。它只覆盖原生GOP解码帧缓存，不是进程RAM/显存总硬上限。上游会在淘汰时保留两张完整源帧，桥在打开时保守预留width×height×16字节；不足返回明确错误。第三参数是画质短边档位：720档横片最大1280×720，竖片最大720×1280，其它档依此类推。显式宽高须成对提供、保持显示比例、符合质量边界与源显示尺寸；PAR参与显示几何校验。小视频不放大。原生解码后转换和管道缓冲仍需额外计量。

体验版兼容限制：90°旋转同时SAR≠1时，FilmCraft倒置PAR后的绝对显示尺寸与既有预览几何可能不同，当前明确拒绝超界输出；普通竖片和单独SAR已支持。该组合未作为已通过素材类型。

stdin UTF-8每条一行，最多4096字节；id是全进程严格递增的正整数，取消与寻帧共享序列：

```text
1 254016000000
cancel 2
3 508032000000
close
```

普通请求为id与源显示时间，时间单位254016000000 ticks/秒。cancel取消当前及待处理请求，自己没有回复；后续id仍须增大。新请求替换旧请求，旧结果不可当当前结果显示。close或stdin EOF取消工作并释放解码器；最后输出closed回执和缓存占用。关闭stdout读端将终止该桥，不留后台媒体任务。

stdout二进制封包：uint32 LE JSON字节长度、uint32 LE载荷字节长度、UTF-8 JSON、像素载荷。JSON≤8192B，载荷≤64MiB。

- ready：protocol=2、durationTicks、sourceWidth/sourceHeight、qualityHeight、outputWidth/outputHeight（未显式指定为0）、audioStreams、codec、cacheCeilingBytes、openMs。媒体信息不是硬解确认。
- frame：id、实际源显示ptsTicks、width/height、各阶段计时、缓存和硬解输出/回退计数、pixelFormat。默认rgba载荷width×height×4。
- 请求yuv420p时，兼容Yuv8/C420/无alpha画面且传递特征为Bt709或Srgb，才发送连续Y/U/V；长度为width×height+2×ceil(width/2)×ceil(height/2)。colorMatrix为bt709/bt601、fullRange来自frame.color。非整数目标尺寸在Y/U/V平面双线性缩放后发送，不再先将整张4K转成CPU RGBA。其它矩阵/传递特征、alpha或RGB回退rgba。传输保留帧身份，不改代理压缩格式或源帧映射。
- error：该请求id与message；fatal：进程失败。
- closed：cacheBytes与liveDecoders。接收端须等stdio排空后的进程close事件，不能只等exit。

## 上游修改

patch-upstream.cjs校验原文件SHA后重建两处集成补丁：按返回Arc身份取得真实缓存PTS并加容器edit_offset；显式GOP字节预算，取消原64帧最低reserve扩大占用。MP4打开时禁用上游编辑器的snap_to_frame_grid/rebase_unedited_video两处调用，保留原样本PTS和容器edit_offset，以外部源帧索引作为标注的唯一身份，不能静默修正VFR抖动或非零起点。MFT/GPU解码代码恢复上游原版；此前半秒读回试验未带入正式桥。请求时间不会写成“实际时间”。实际源码补丁回执在独立native-patch记录中。

build.ps1只编译平台crate的eagle_media例子，使用Rust 1.95 GNU和自带rust-lld；无需编译完整FilmCraft。生成SHA构建清单、FilmCraft许可及132个正常Windows依赖的合并许可/来源。Symphonia的crate包省略工作区根LICENSE，licenses/Symphonia-MPL-2.0.txt取自其锁定包VCS revision 6d533f26150953a882a6a111ebd13f0abf7129d5的原文。第三方MPL组件未修改，notices明确提供对应源码入口。

E45已执行10项纯缩放/平面/黑白边界测试，构建日志/二进制哈希见本机回执。新的真实媒体、Eagle及体验结果由E44交付记录承载，不能沿用旧二进制成绩。
