# E-25 修复结果

代码原因：侧栏margin过渡改变元素尺寸但不触发连续window.resize；drawing-ui此前只在窗口resize/数据变化时layout，因此SVG保留动画开始的尺寸。新增ResizeObserver观察screen/picture，仅更新布局和文字编辑框位置，不渲染对象、不提交草稿；销毁时disconnect。

截图中的文字蓝底与浏览器原生选区外观一致。实现限制在drawing-layer及后代：user-select:none、selectstart取消，并在画面按下时仅清除端点位于该图层的原生选区；drawing-text维持user-select:text。没有更改保存的文字/颜色/对象。真实Eagle截图原因仍需用户复验，浏览器已验证选区阻止。

全屏入口合并到右侧中间窗控，移除左侧按钮；右侧调用原hostAction(fullscreen)，F11保留。最小化/关闭不变。

标准Chrome67项（verification-runs/e25-browser.log）、720×480减少动画65项（e25-compact.log）通过，含真实SVG文字、箭头、动画中途和终点/收起后矩形对齐（误差<1.1CSS像素）、输入选字边界、单一全屏入口。默认非宿主检查通过（e25-default.log）；git diff --check通过。2轮浏览器，临时profile核对后自动清理。真实Eagle、实际视频与系统全屏未执行；未安装插件或写素材库。
