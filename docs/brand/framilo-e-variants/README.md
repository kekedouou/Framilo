# Framilo：E 连续帧变体

历史稿：用户曾偏好首轮E，随后否定全部变体并明确放弃E方向。当前见[六款新方向](../framilo-round2/README.md)。本目录保留原始证据，没有替换正式插件图标。

[对照图](contact-sheet.png) · [可缩放展板](contact-sheet.svg) · [浏览页](index.html) · [原版E](../framilo-round1/e-cadence.svg) · [阶段计划](../../experiments/E53/plan.md)

| 方案 | 调整 | 取舍 | 文件 |
| --- | --- | --- | --- |
| E0 原版 | 保留原始三片帧与末片反折 | 对照基准，不覆盖旧稿 | [SVG](../framilo-round1/e-cadence.svg) |
| E1 均衡 | 优化帧宽、间距和重心，保留反向折角 | 最接近原版，调整克制 | [SVG](e1-balanced.svg) |
| E2 紧凑 | 加宽帧片，降低整体高宽比 | 更结实，小尺寸优先；少一些修长感 | [SVG](e2-compact.svg) |
| E3 四帧 | 改为四片、细化递进 | 连续感更强；16px时条缝更细 | [SVG](e3-sequence.svg) |
| E4 前倾 | 主体向右倾斜，保留长短关系 | 速度感更强；小尺寸更受抗锯齿影响 | [SVG](e4-forward.svg) |
| E5 折带 | 将第二片顶端与末片连接为折带 | 轮廓更完整；独立帧感减弱 | [SVG](e5-fold.svg) |
| E6 显形F | 将中间帧拆成上下两段 | 更易读为F；比原版更像字母标识 | [SVG](e6-initial.svg) |

设计计划：沿用首轮黑白、淡蓝及本机Bahnschrift/Segoe UI字标，统一展示尺寸；原版单列在顶部，六款变体三列两行、说明左对齐。变化只放在帧片数量、间距、长短、倾斜与连接关系，避免用换色冒充变体，不增加圆形播放按钮或装饰渐变。

自审：E1最保留用户选择的感觉，E4更动态，E5更完整；E3/E6作为更明显的边界探索。所有版本展示单色16/24/32px与深浅底24px。小尺寸是对照，不代表最终像素级光学校正完成。原版E与首轮其它方案保持不变。

预览：本地打开index.html，无需服务、网络或安装。点方案打开透明SVG；若浏览页不可用，打开PNG/SVG展板。PNG为SVG经浏览器Canvas导出，不是HTML截图；用于品牌选择，不代表播放器或Eagle验收。重建命令 `node docs/brand/framilo-e-variants/build.mjs` 生成SVG与HTML，不生成PNG。沿用E53品牌资料合计≤8MiB预算。最终变体等待用户选择，不把建议默认替换为正式图标。
