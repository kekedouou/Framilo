# E50 实施与验证

2026-10-31：第一阶段候选完成代码、适用本地回归与真实浏览器空状态检查；真实Eagle集中体验待验，尚非发布通过。运行基线E49冻结503e0a6，规划基线e3de7b4；冻结标签不变。本轮只在本地提交，不推送远程或制作安装包。

已知依据：用户确认监测开启发生热命中卡顿，关闭目前无感；前轮独立Node缓存扫描最大计时器间隔193.7226ms，详见[调查](../../releases/motionote-preflight.md)。这是同一问题的两类证据，不伪称已执行真实Eagle计量。

## 实现与范围

- proxy-storage/live-resources：逐文件异步身份检查与大小统计；取消在途扫描；避免源变化后发布旧当前占用；缺失单文件不抹掉既有总和；只读采样不新建目录。proxy/JPEG/pending/其它分类通过总磁盘悬停呈现，pending为proxy子集。
- performance-runtime：新事件/源变化才重算有界快照及汇总；没有新事件时等待时间仍更新。监测关闭停止并取消资源采样。
- whole-proxy/native-backend：失败先进入cleaning，等待写进程退出、核对自有目录/owner/文件，再清理并发终态。额度与物理磁盘不足分别说明；身份异常、未知文件、清理失败保留恢复锁与原因，不能宣称回收。GPU回退也受回收完成约束；清理期间不启动重复代理。无可清理明确解释当前源各画质/活动/未知文件保护。
- Session/UI：仅SELECTION_EMPTY变为正常empty，按钮“读取选中视频”；API/释放错误继续error。再次选择沿现有Session加载与草稿保护。
- 未调整编码、代理格式、画质、资源额度、标注格式；未开发4K、输入扩展、JPEG退役、独立版或新长片阈值。没有清理真实素材、共享缓存或未知残片。

## 检查及证据

1. `node scripts/check.cjs --without-prepared-host`通过：语法/模块边界、现行测试、manifest/资产、文档与交接检查。首次停止于旧容量文案断言；已改为磁盘额度提示契约，不豁免功能。Session旧空选择error断言同时更新为empty并验证重选，API错误仍error。初始日志与最终日志位于verification-runs/e50/check-initial.log、check-final.log。
2. 新增tests/e50-monitor-scan.cjs五项：禁止扫描调用同步元数据、150文件精确计数及事件循环让出、取消、分类/只读不建目录、源变化/关闭忽略旧结果、汇总复用与等待增长。现行whole-proxy共36项、Session51项、native-backend15项、E45资源/存储8项通过；覆盖现有取消、死owner重启恢复和活动读者保护。新增额度失败、未知文件清理失败、缺owner和物理硬盘满四项；断言在最终回调之外执行，避免通知吞异常造成假通过。最后一项追加后单独重跑代理36项通过，证据proxy-final.log。`node scripts/package-release.cjs native-experience`只读清单核对通过、68份依赖许可闭包完整，无新ZIP，证据package-check.log。
3. `node scripts/probe-monitor-scan.cjs`对同一实际plugin/cache只读顺序测量三轮。Node v24.20.0，每轮旧/新统计567684071B一致；不删除回执掩盖问题。证据verification-runs/e50/scan-1793448078852.json，包含时间、基线、修改后文件SHA及原始计时。

| 轮次 | 旧扫描耗时 | 新扫描耗时 | 旧16ms计时器最大间隔 | 新最大间隔 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 345.53ms | 511.08ms | 340.98ms | 19.51ms |
| 2 | 189.04ms | 461.92ms | 185.32ms | 19.01ms |
| 3 | 165.99ms | 374.90ms | 163.27ms | 17.16ms |

扫描总耗时更长，但异步等待可让界面事件运行。这不是拖动/播放帧延迟或真实Eagle结果，不把计时器长间隔降低宣传为播放器提速倍数。没有为此次修复重建代理或跑视频压测。

4. Ego语义/DOM验证使用正式HTML/CSS/UI与替换的模拟Session，不加载app.js或Eagle/媒体接口。无素材时error隐藏、重选点击一次触发retry一次；API错误仍显示错误与“重试”。截图已目视检查，空态不再是红色致命提示；证据verification-runs/e50/browser-result.json、empty-state.png及browser-01～03.mjs。浏览器任务已正常结束，没有鼠标控制。

## 尚未验证及集中体验

未自动接管真实Eagle。本地检查不替代Eagle Node16/Chrome108手感、后台生成竞争和物理硬盘满现场。建议集中体验同一已完成代理/热RAM视频，监测开/关对照播放/拖动，再试无选中打开与重新选中。额度失败的文件回收已做隔离模型；真实容量故障不能在用户原库强造。若仍有停顿，再收集宿主事件循环/资源采样证据，不先改媒体架构。

## 文档、版本与整理

同步README、profile模块导航、product、architecture、development-plan、roadmap、verification、performance/WORKFLOW、progress和发布调查的后续状态。E49冻结发布记录/标签、旧实验结果无变化，保留原证据，不伪改历史。E50计划/报告与本地Git提交构成新恢复入口；性能验证有必要，因为触及采样/缓存扫描。

本轮只清理归属明确的临时技能说明/空测试目录，保留小型复现脚本、完整检查日志、计时JSON和DOM截图；运行中的本地QA服务器结束后停止。无媒体生成，临时测试文件用后按真实路径核对回收。旧3个暂存探针与40个未跟踪退休文件沿既有例外保留，不混本轮提交，require-clean因此不能为通过。提交前执行handoff --base HEAD及diff检查，提交后核对剩余43项仅为旧差异。

复盘：先区分“媒体慢”和“监测阻塞”，用用户开关对照加同目录异步计量定位；不以删缓存消除复现条件。失败提示必须晚于实际回收，不能用一个ENOENT推定目录已空。本轮仍保留宿主集中验收，未把模型通过当发布完成。
