# 石墨编辑室 / UI-05

隔离交互样稿，正式 plugin 无修改。启动上一级 server.cjs 后，打开 `/graphite/index.html`，参数工作台为 `/graphite/lab.html`。

三参数：记录栏宽度、收起延迟、文字框高度；独立 localStorage 命名空间支持最多12个命名版本、恢复及JSON导入导出。数据不含素材和标注。

右键长按/甩动操作图标扇区，类型外圈原位展开，回中心取消。记录单列、选中信息置顶；标注保持画幅。六状态浏览器截图在 shots/。

视觉来自 UI-02 原创 SVG 四帧插画，不是真实解码或连续媒体。保存仅内存刷新即失；最小化/关闭提示未接入，最大化用浏览器全屏；画质和资源设置仅演示字段。模型的R长按全选未实现，橡皮为整对象擦除。

验证见 docs/experiments/UI05/report.md。本阶段4轮浏览器预算已用完，后续修订先记录新验证范围与预算。模型检查：`node prototypes/video-first/graphite/model.test.cjs`。界面文件独立可编辑，复用上一级lab.css和design-round-02/assets，无额外依赖。
