# Framilo

## 运行条件

需要 **Windows x64、Eagle 4.0 Build 22 或更高版本**，并安装 Eagle 的 **FFmpeg 依赖插件**。无需另装 Node.js 或 Rust。

若提示缺少接口，请确认 Eagle 版本符合要求，并重启 Eagle 后重新打开。

## 快速验证

1. 在 Eagle 中选中一个测试视频，打开 Framilo。
2. 检查播放、暂停、拖动定位及滚轮逐帧。
3. 按 N 添加文字与圈画，保存后按 B 查看记录。
4. 关闭后重新打开，确认标注保留，并检查播放与定位是否正常。

验证会向 Eagle 对应素材保存文字标注，请使用可修改标注的测试视频。

圈画与偏好分别保存在插件目录的 `annotation-data/` 和 `memory-settings.json`。卸载正式安装版会随安装目录删除这些数据，请提前备份。

## 原生组件与许可

- 部分媒体读取与解码功能使用了经修改的 `storytold/filmcraft 0.13.0` 代码。版权、许可证及第三方来源清单位于 `bin/`。
- 后台任务保护程序用于管理媒体进程生命周期，源码位于 `native/task-host.cs`。
- FFmpeg 由 Eagle 依赖模块提供，未内置于本安装包。
