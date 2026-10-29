# 性能当前状态

当前：E-44已获用户批准，WebCodecs首轮未通过，FilmCraft原生源码已完成三轮真实Eagle验证：硬解确认、光标P95为6.9～7.1ms；整体A尚未全部验收。开发依赖已按授权隔离安装，临时预算8GiB。整片代理重建按[计划](../experiments/E44/plan.md)推进；[实施记录](../experiments/E44/report.md)区分本地检查、真实Eagle和体验验收。旧E43正式代码暂保留，未开始清理或替换。以下旧阶段内容是保留的实现与历史证据；E44实际通过后再更新运行模块与操作说明。

2026-10-28 FilmCraft实测：[三轮报告](../../verification-runs/e44/filmcraft-report.html)。实际硬解已确认；光标P95为6.9～7.1ms，原片冷跳P95为1.64～1.68秒，比同轮普通video慢约11%～13%。0超时/错误PTS；180个快拖旧目标被替代且未出图，不计作流畅出图。此结果单列，不接受为正式基准。


2026-10-28：E44已批准并运行真实Eagle隔离直读测量。新数据单列于[E44报告](../experiments/E44/report.md)，不写入正式标准基准，也不混算E43。硬件偏好准确出图不代表光标达标；被并行Chrome干扰的轮次排除。下文是旧E43记录，GPU生产快慢不能由本次直读测量替代。


## 最新测试事实

运行：2026-10-27T13-57-04-223Z-7a18981a

代码快照：eef68cf785b9a0c9a3a36cc3c900a48a52de0547ec5c0a4d1fae03800dc6e59a

状态：completed，待审阅；范围：Eagle renderer / formal Player, software submission only。请求 1846，成功 691，P50 5.299999997019768 ms，P95 27.799999997019768 ms。未设定达标阈值，尚未接受基准。

[测试对比图](../../artifacts/performance/report.html) · [事实摘要](../../artifacts/performance/runs/2026-10-27T13-57-04-223Z-7a18981a/summary.md)

## 最新 AI 分析

分析与本轮运行及代码快照一致。

运行：2026-10-27T13-57-04-223Z-7a18981a

代码快照：eef68cf785b9a0c9a3a36cc3c900a48a52de0547ec5c0a4d1fae03800dc6e59a

[分析](../../artifacts/performance/runs/2026-10-27T13-57-04-223Z-7a18981a/analysis.md)
