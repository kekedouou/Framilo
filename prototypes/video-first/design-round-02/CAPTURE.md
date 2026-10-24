# UI-02静态设计截图

capture.cjs只渲染本目录的HTML/CSS，使用现有Node24与Chrome，不安装依赖，不运行旧UI-01检查或正式播放器。服务仅绑定本机随机端口，浏览器使用独占临时配置并禁止外网。

```powershell
# 三方案×四状态，再加三张方案总览，合计15张
node prototypes/video-first/design-round-02/capture.cjs --all

# 有明确修正后，只重拍受影响方案/状态
node prototypes/video-first/design-round-02/capture.cjs --scheme b --state records
node prototypes/video-first/design-round-02/capture.cjs --scheme b --boards
```

默认捕获三方案四状态，不包含总览；--boards只拍总览，--all包含两者。单页1600×1000，总览1600×1490。页面须设置window.DESIGN_READY为true或Promise；总览同样等待内嵌页面、字体、图片解码与两次绘制。

交付截图放shots/，固定15种命名只替换同名交付图；每轮摘要保留新旧SHA256、几何、运行时错误、外网请求与清理回执。证据在verification-runs/ui02-static，最多4轮、每轮75秒、证据36文件/30MiB、交付15PNG/20MiB、临时配置128MiB。临时目录结束前核对路径、身份、文件指纹、Chrome进程引用后定点清理；原始失败证据不覆盖。

检查只能说明静态页面在独立Chrome的布局与渲染情况，不能证明可操作性、真实Eagle窗口控制、定位精度、播放响应、资源或长期稳定性。
