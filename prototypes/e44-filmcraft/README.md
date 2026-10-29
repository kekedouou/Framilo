# E44 FilmCraft 原码验证器

隔离实验，不是正式播放器。上游 `storytold/filmcraft` 固定于 `176e6a9c585fd29e4b18d691663fe88a936c5b37`（0.13.0，MIT OR Apache-2.0），下载原件、LICENSE-MIT、LICENSE-APACHE、NOTICE 保存在 `verification-runs/e44/filmcraft-source/`。本目录不复制品牌或 UI 资产。

- `bridge.rs`：测试进程接口；直接调用上游 `platform`（Windows 硬解与回退）、`codecs`（解封装/准确寻帧/GOP 缓存）、`media`（随机读取/取消）、`frame`（缩小/色彩转换）源码。`patch-audit.cjs` 添加实际缓存 PTS 审计，并保留默认关闭的有限回读试验；不能称核心完全未修改。标准输入/输出及 latest-request 队列为本项目适配代码，不称作复用了完整 FrameServer 或编辑器。
- `client.cjs`：Node/Eagle 客户端，按源 PTS 核对输出；旧结果不显示、错误不假称成功、关闭有截止时间。
- `bench.cjs`：同一 E44 固定源/91 次操作，独立原生进程，**不测 UI、音频或物理显示**。`--both` 另测软件；未加参数只测硬件。原始记录新增保存，不覆盖旧结果。
- `host.js`：在已注册的 E44 技术样机增加 FilmCraft 对照入口，使用相同 `gate.js` 计时；仅这里的记录可标记真实 Eagle。没有放入正式设置/按钮。
- `build.ps1`：只编译上述桥和上游 `mfprobe`/`mfcaps`；依赖固定上游 Cargo.lock，双编译任务、关闭增量/debug/LTO 控制临时占用。
- `wire.cjs`：有界分包，每个输入字节仅复制一次，避免重复拼接整个 RGBA 图像。
- `verify.cjs`：真实原生进程的 7 点像素一致性及 50 次生命周期；不是宿主整机验收。

## 复现

已有隔离工具和源码时：`powershell -NoProfile -ExecutionPolicy Bypass -File prototypes/e44-filmcraft/build.ps1`。使用 Rust 自带 rust-lld 的 `ld.lld` 模式链接；默认 GNU 链接器在本机 COM/TLS 最小用例崩溃，不能切回它并认为与已测二进制等价。`shims` 内 LLVM dlltool 及依赖需要一起保留。Q: 必须指向本项目的 `verification-runs/e44`，脚本会核对。

`node prototypes/e44-filmcraft/bench.cjs --both`：独立后端软/硬对照；`--target-readback` 只重现默认不采用的回读试验。`node prototypes/e44-filmcraft/verify.cjs`：正确性与关闭。媒体测量串行运行；每轮 10 分钟封顶，不与编译或其它媒体基准重叠。宿主结果需从已注册 E44 隔离窗口运行，不能用命令行成绩冒充。

## 边界

授权安装的 Rust 1.95 GNU 工具链放项目隔离目录，无系统 PATH 修改；Q: 是 E44 目录的短路径别名，解决 Windows Git 长路径问题。第三方库按锁文件下载。8 GiB 是源码/工具/构建临时预算，不提高正式媒体缓存额度。

上游单轨 GOP 缓存上限 384 MiB（进程池另有 1 GiB 规则），此前 WebCodecs 样机只有 256 MiB 目标帧缓存：不能把结果宣称为等 RAM 算法对决。4K 解码后用上游 box_decimated 缩小再转 RGBA，管道传入 Eagle 由 CPU Canvas 提交；尚非零拷贝，也没有实现整片代理、音频或正式 UI 迁移。

实际数据与限制见 `docs/experiments/E44/filmcraft-reuse.md`，正式门槛仍在 E44 plan。
