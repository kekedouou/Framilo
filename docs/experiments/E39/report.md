# E-39 实施记录

> E41追溯：本文保留当时实施/失败的历史说明。用户随后明确要求清理旧性能记录；除指定“流放之路”标准外，其余旧performance-reports/artifacts/performance运行及对应辅助副本已删除，不再声称原始文件仍存在。其它历史验证证据不在此次清理范围，见[E41回执说明](../E41/report.md)。

2026-10-27：本地可读监测、固定条件测试、可导出对比报告与代理帧条已实现。模型、离线浏览器与默认回归通过；新固定协议的真实媒体轮次和实际Eagle体验未验。本轮没有调整播放/编码/缓存策略，没有接受性能基准，按既有明确要求未提交Git。

## 已交付内容

实时监测从指标清单改成“当前现象＋等待条＋建议”。可识别仍在准备目标位置、资源返回、解码还原、临时低清和准确帧跟上；stage-begin让尚未完成的等待可见。内部不能拆分的读取/校验/传输合并呈现，未覆盖时间按区间并集计算；不把慢阶段当成已证实根因。保留可展开的记录/固定测试操作，默认关闭、333ms刷新。

新report.html包含同条件历史横条、相对上次的等待差值、不同视频时长/画质覆盖矩阵、独立体验记录。页面不再嵌入工程JSON/代码标识。支持PNG/SVG下载和打印；导出图保留范围和限制。原始记录及其hash不改；artifacts/performance和plugin/performance-reports的顶层视图已重新生成。现有E38实测只作早期参考，不称为本轮优化结果。

固定组要求源/配置/环境一致、代理全片完成，先准备相同路线，再等待在途工作归零和缓存连续300毫秒稳定（最多10秒），才开始三轮288次输入。起始缓存集合/顺序指纹不同自动分组；原始轨迹完整性不匹配拒绝视为完成。准备期间停止、改条件、关闭保持取消/失败，不继续计时。独立固定配置已登记现有RIOT源（49.301秒、2560×1440原片）、720p代理、512MiB RAM及工具文件hash，尚未运行新媒体测试。OS缓存、其它软件负载、温度频率不声称受控。

设置→显示新增代理帧条，默认关闭。淡蓝条只显示published可读代理租约范围，与RAM绿条独立；非连续片段保留空隙，循环裁切、换源/准备/JPEG时不残留。偏好正常重开及部分写入/原子替换后中断已检查；工具栏等其它写入端保留该开关。此开关不启动新的准备任务、不重新加载播放器。

## 检查与证据

| 检查 | 结果与边界 |
| --- | --- |
| 默认回归check.cjs --without-prepared-host | 通过；verification-runs/e39/default-check-fixed.log。初次失败为旧UI模型未登记新增showProxyStrip参数，已修正预期并加入待应用设置保持检查；原失败default-check.log保留 |
| performance-readable模型 | Node24通过（readable-settle.log）；Eagle附带纯Node16通过（node16-check.log），覆盖阶段/重叠、固定组重开/改变、288次输入、准备中停止/关闭/改条件、已发布范围。纯Node不是Eagle窗口 |
| 偏好与显示 | memory-preferences、toolbar-settings、t1-session、t1-ui、proxy-strip-display与proxy-background通过；验证读写重启/中断、其它入口不覆盖、缓存条独立、非连续及循环裁切 |
| 离线界面/导出 | presentation-final.log、presentation-check.json：真实Chrome验证报告图、各按钮/状态、监测面板1280×900与640×480限位、实际PNG/SVG下载；操作是模型，不是Eagle。report-view.png、report-export.png、monitor-view.png已目视复核 |
| 固定源登记 | artifacts/performance/standard-profile.json记录原RIOT源和工具文件hash，未覆盖/生成视频；不是已接受基准 |
| 证据保护 | 旧三轮工作区报告及三轮插件体验原始记录保持；新顶层report/index按旧证据重绘。旧E38三次媒体预算未重跑 |

补充：最后的监测销毁收尾在成功/失败时都关闭采样定时器和埋点；对应模型复验日志见readable-close.log。报告刷新与浏览器检查的临时文件经身份/大小/hash核对后逐项删除，回执写入各日志；模型和Chrome均使用本轮独立scratch。首次Chrome受沙箱限制未启动（presentation.log），提升后完成；第一次纯Node尝试无输出，未当作通过，正式spawnSync检查有退出码与输出证据。

## 仍未验证

- 新的E39固定准备协议在真实媒体和Eagle中的完整运行；目前新协议仅模型闭环，不能声称标准化性能验收完成。
- Eagle中的实时等待解释、低清状态与代理条实际视觉；实际面板合成开销。本轮没有重新测量性能，E38轻负载开销不能代替E39。
- 跨视频/画质/长会话稳定性、物理鼠标/屏幕、音画与像素画质。图表空白项和未知项如实保留。

## 文档与收尾

已同步README、project-profile模块导航、product产品决定、architecture观察/测试/持久化边界、development-plan、roadmap、verification、progress、performance/WORKFLOW及STATUS指向。BASELINE仍unset；AGENTS沿用上一轮性能任务规则，本轮没有新的长期权限规则。E38及更早实验报告、发行包、已接受演示均为历史冻结，不伪改日期或验收结论。

工作区仍有E38未提交工作和本轮E39改动；三个原暂存Git界面探针原样保留，未混入本轮或丢弃。不执行提交/推送，也不声称工作区干净。check-handoff --base HEAD核对当前入口与记录，详细结果保留handoff.log。

复盘：先前把工程统计直接当作用户反馈、且未严格锁定准备状态，影响理解和可比性。本轮采用“实时解释现象、固定条件比较、未知部分留白”；这种展示与验证边界已实现，真实性能改善仍需新实测，不能以图表更易读宣称播放器更快。本轮建设结束，不继续优化策略。
