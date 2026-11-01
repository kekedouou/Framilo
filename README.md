# Eagle Video Analysis · 视频分析

从特效观察出发的视频参考与标注播放器，流畅拆解每一帧。产品英文名暂定Motionote。

[当前候选、授权与待验](docs/progress.md) · [开发地图](docs/project-profile.md) · [能力与限制](docs/releases/motionote-capabilities.md)

## 使用
Windows x64、Eagle 4.0 Build 22+及Eagle已有FFmpeg模块；日常使用无需另装Node.js或Rust。
已注册本仓库plugin的用户，关闭旧窗口，在Eagle选中本地视频后打开“视频分析”。默认720p、1GiB RAM；使用统一的原片/代理播放路径，设置应用后保留位置并暂停。
播放/暂停、逐帧/慢放、源帧时间轴与循环、文字/圈画和右侧记录可按需组合；代理后台完整生成并核验后同帧接管，等待准确帧时保留上张画面并保护标注。格式/画质/资源的准确承诺以能力表为准。

## 数据与版本
原视频保持不变；用户主动保存/编辑/删除标注会更新相应Eagle素材。正常关闭会清理本窗口生成的媒体缓存，重开重新准备；累计预计超过1 GB先确认，设置不提供磁盘额度选项。缓存清理不删原视频、标注或设置；受管RAM额度不等于整个Eagle/驱动内存上限。
当前源码、已发布旧Beta安装包、E49冻结标签是不同交付物，不将GitHub源码ZIP当已验安装包。恢复标签固定503e0a6，见[冻结记录](docs/releases/e49-frozen-2026-10-30.md)；旧Beta2固定720p及短MP4范围，见[安装说明](docs/beta-preview.md)与[发行记录](docs/releases/v0.1.0-beta.2.md)。
本机视频、缓存、偏好和原始证据不随源码提交；当前候选是否已通过真实Eagle/全素材/长稳只见当前交接，不以本页概括代替验收。

## 开发与资料
唯一正式实现为plugin；[原生桥源码/许可](native/filmcraft/README.md)与plugin/bin运行程序分别维护。可批注的同源界面预览由Codex按需启动，使用合成样本，不连接素材库；入口和恢复说明见当前交接。命令及副作用见开发地图；快速只读文档检查：node scripts/check-docs.cjs。
[产品](docs/product.md) · [架构/模块](docs/architecture.md) · [开发/文档/Git流程](docs/development-plan.md) · [验证](docs/verification.md) · [路线](docs/roadmap.md) · [阶段索引](docs/experiments/README.md) · [更新记录](CHANGELOG.md)
尚未指定项目整体开源许可证；第三方组件保留来源和许可。Eagle与FFmpeg外部程序不随源码标签分发。
