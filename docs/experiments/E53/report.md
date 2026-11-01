# E53 execution record

## A定稿与自用候选 — 2026-11-01

用户选定新A「流线F」，批准连续推进五包，并确认Eagle载入本项目plugin目录。基线494de89，候选代码70515ca；正式名称Framilo、版本0.2.0-private.1、256px图标已接入，插件ID、存储身份、原生程序529ed38和E49冻结503e0a6不变。A/B代码完成；C自动检查完成但真实宿主待验；D本地包和恢复快照完成、实际恢复待验；E仅建立观察登记，不能称五包全部验收。

品牌母版与小尺寸板见[定稿](../../brand/framilo-final/README.md)，自用/数据/恢复说明见[自用版](../../releases/framilo-private.md)，集中验收与长期计数见[清单](acceptance.md)。正式运行文件没有开发服务、素材或额外遥测；旧Motionote内部标识和历史路径不机械改名。

验证按范围分开：
- 完整默认检查`node scripts/check.cjs --without-prepared-host`通过，原始日志verification-runs/e53/checks-1793519878858.log及JSON回执。早期失败分别是旧Beta测试读取新manifest、历史宿主准备器硬编码旧标题；修正测试来源及标题替换后重跑通过，失败日志保留。
- 显式有界`node scripts/e53-native-check.cjs`通过17组合/85次准确源帧读取，所有close均收到完成回执，原合成素材SHA不变。原始记录native-check-1793519551706.json；15种现有E52自有样本覆盖常用容器、编码、VFR、音轨起点、60fps和4K，另有H.264/4K硬件路径，实际硬解帧计数非零且无回退。此项是独立原生读帧/关闭检查，不证明Eagle音画/连续播放/人工手感，不是新性能基准。
- 运行闭包83文件、原生文件和第三方许可检查通过；新private-package模型检查篡改/越界/身份/版本/验收标志。冻结Beta配方保持原版本。代码提交后生成独立包并验证归档与异目录运行，结果如下。
- Ego任务8检查品牌板10张大小/背景图，正式PNG已目视检查；隔离预览标题Framilo、favicon返回image/png、记录面板打开成功，回执browser-brand-acceptance.json。初次空格探针超时，随后捕获play调用但未完成可靠时序判定，不计入键盘或播放时延验收。无故修改播放逻辑不是本轮范围。

前端预览在新端口13668，入口与恢复见交接；复用E52合成片，不连接Eagle/真实数据。旧9506用户草稿未动。Codex打开请求仅返回queued，不冒充用户已经看到。Ego任务8已结束，保留预览服务供用户查看。包构建使用干净提交：`node scripts/package-private.cjs build HEAD`与`build 494de89`；仅在dist新建不可覆盖的运行快照/ZIP/SHA，拒绝未知文件与个人数据，不安装/发布。

本地包回执verification-runs/e53/package-verification.json：

| 用途 | dist下ZIP | 大小 | SHA256 |
| --- | --- | --- | --- |
| 自用候选 | framilo-0.2.0-private.1-70515ca-win-x64.zip | 12,232,100 B | 275e521ebec43841813ad01e14eff797231bfa35e029648795957b23a47a4d90 |
| 改品牌前恢复 | framilo-0.1.0-beta.2-494de89-win-x64.zip | 12,229,383 B | 0b70f635e4e26c642d541d1dc576a2dcc6195a0b9974f4c99f51bfa92992508f |

两包各有独立展开目录、BUILD-INFO逐文件SHA和ZIP校验文件，83个运行文件及132组件许可完整；恢复包旧manifest版本不表示它就是冻结Beta发行包，身份以494de89提交为准。自用/恢复目录各执行`--smoke`，CPU/GPU各5帧与关闭回执通过，证据native-check-1793520753560.json、native-check-1793520860459.json。没有向真实Eagle重新注册、替换用户数据或演练实际恢复。

有界盘点：dist共86,111,386 B（≤256MiB）、E53证据约0.4MiB（≤64MiB）、全部品牌资料773,612 B（≤8MiB）。不新增媒体/下载/编译副本。两个本地唯一包、用于异目录验证的展开目录及原始失败证据保留；展开目录待实际恢复验收后可定点清理，ZIP在有核验替代包前保留。旧Beta包/原型/历史证据未删，未凭Git忽略清理未知文件。

本轮不改编解码、代理、缓存策略，因此不重跑历史性能实验；基础原生检查用于自用交付闭包/既有格式回归。产品架构正文和既有能力限制未变化，历史实验、冻结包与证据保护。无新依赖、远程推送或真实标注写入。真实宿主验收、实际恢复和14天观察仍待执行。

## E direction abandoned; new shape and wordmark exploration — 2026-11-01

Baseline9bc878b clean. User rejected every E refinement and requested unrelated directions. [New board](../../brand/framilo-round2/README.md) offers A flow, B link, C echo, D ink, E negative-space F and F custom script wordmark. This round's E label is not the old cadence design. Previous boards remain historical; plan, roadmap and handoff now supersede the E-selection decision. No final logo choice inferred.

Delivered editable icon/wordmark SVGs, generator, responsive HTML, colour and monochrome boards. Visually checked the 1536×1152 PNG for readable labels, intact shapes and small-size samples. PNGs are SVG Canvas exports, not HTML screenshots. Ego space7 verified six cards and no document horizontal overflow at1440/800/390px; verification-runs/e53/framilo-new-layout.json records results. Browser task closed; no user preview tab changed. Local HTML needs no server; PNG/SVG provide recovery.

Tradeoffs include link/audio/ink associations and provisional script optical spacing; final small-size mastering and user selection remain pending. Document/link/diff, SVG parsing and output-budget checks apply. No runtime/native/media/performance regression is needed for brand-only files. Runtime branding, plugin identity, annotations, installed binaries, frozen releases and historical evidence are unchanged; no remote push or release.

## Cadence E selected; six refinements — 2026-11-01

Baseline7a5a08f clean. User chose E's continuous-frame direction and requested refinements to choose from. [E-series board](../../brand/framilo-e-variants/README.md) retains E0 as reference and adds E1 balanced, E2 compact, E3 four-frame, E4 forward lean, E5 joined fold and E6 explicit F. Same palette/wordmark/display scale isolates shape differences; no runtime branding replacement or final selection inferred. Original six concepts remain intact apart from a navigation/status note.

SVG/HTML generated locally; PNG rendered from SVG through ego Canvas, not a screenshot. Visually reviewed seven silhouettes, labels, light/dark and small-size samples. E3/E4 have thinner small-size gaps and require optical work if selected. Browser checks/receipts in verification-runs/e53/framilo-e-*; budget, XML, document/diff checks apply. No media or runtime change, therefore no native/performance tests needed. Product code, installed icon, stable identity, historical releases and evidence remain untouched.

## Framilo selected; six new logo concepts — 2026-11-01

Baseline d754b4a clean. User selected Framilo and requested multiple redesigned logos. Read frontend-design skill, used a consistent dark/white/pale-blue board and six distinct subjects: cut F, folio, retrace, pinpoint, cadence, insight. Plan and critique are recorded in [brand README](../../brand/framilo-round1/README.md). Original paths, no raster generation, no remote assets/fonts/dependencies. F was revised from a hexagonal mechanical-looking contour to an almond eye during visual critique. Standalone D uses a transparent knockout mask; board samples use matching background knockouts.

Delivered six standalone SVGs, rebuild script, HTML, SVG/PNG comparison board. Ego space5 verified all six concepts and no horizontal overflow at 1440/800/390px (three/two/one columns); receipt verification-runs/e53/framilo-layout.json. Canvas exported the SVG board as a 1536×1250 PNG, visually inspected before and after F revision; this is not an HTML screenshot. Space closed, existing user preview untouched. Local HTML requires no running service; PNG/SVG remain recovery paths. This is brand review, not player interaction or native-host acceptance. Small-size samples are for selection, not final optical mastering.

README, stage plan, roadmap and handoff now reflect Framilo and pending logo selection. Runtime/installed icon, plugin identity, historical drafts/releases, native binaries and stored annotations are unchanged. Name choice is not trademark clearance. Verification is document/link/diff/asset structure/budget only; no media/performance regression run is needed for these design-only files.

## Rename and redesign requested — 2026-11-01

Baseline5e6ab70 clean. User explicitly replaced the prior A-selection direction with a new name and logo, asking first for English names that are easy to pronounce/remember and relevant to the product. [User-supplied YouTube link](https://www.youtube.com/watch?v=ii20RxJvz7g) could not be fetched; skeleton-extraction capability is user-reported, not independently verified here. Prior assets preserved as historical concepts; runtime branding unchanged.

Creative shortlist and rationale are in the plan. Exact-name public-web searches screened out existing software such as [FrameCue](https://framecue.vercel.app/), [FrameTrail](https://frametrail.org/), [Framio](https://framio-app.com/) and [FramePin](https://framepin.com/). Retained candidates Glimark, Framilo, Frameglint, Framint and Fraylo were not cleared legally: search results include a Glimark cosmetics company, [FRAMILO LIMITED](https://find-and-update.company-information.service.gov.uk/company/08434195), Fraylo corporate/domain references and Framint plant-name references. No obvious exact-name video software found for these in this limited search is not evidence of availability. No domain registration or trademark registry clearance performed. Documentation-only governance/diff checks apply, no runtime test or visual preview needed; no new logo artwork claimed.

## A selected; name screening — 2026-11-01

Baseline367ee8b clean. User selected concept A and raised a possible MotionNote name conflict, supplying [IEEE document9090443](https://ieeexplore.ieee.org/document/9090443). IEEE retrieval failed and exact-URL search returned no result; its identity/content have not been verified. Independently, [NOVA's January2020 description](https://novainnovation.unl.pt/web-based-video-annotation-tool-in-real-time/) and [Europeana's project page](https://pro.europeana.eu/page/motionnotes) establish MotionNotes as a video annotation tool with timelines, text and drawings. Do not silently equate the inaccessible IEEE document with that project.

Name similarity and related function justify a recommendation to consider a more distinctive name before final branding, not a finding of infringement. [CNIPA infringement criteria](https://www.cnipa.gov.cn/art/2020/6/15/art_546_146311.html) and [USPTO confusion guidance](https://www.uspto.gov/trademarks/search/likelihood-confusion) provide general context; no territory-specific registry clearance, rights-holder assessment or legal opinion was completed. A is the selected visual direction; final wordmark and runtime branding remain pending. Existing draft assets/README codename are preserved, no rename approved. Documentation-only change: handoff/link/diff checks apply; runtime, native binaries, historical evidence and installed plugin are unaffected.

## Scope transition and brand round 1 — 2026-11-01

Baseline298f18f clean. User authorized phase3, requested a task breakdown and at least five logo concepts, and replaced the public-release objective with private daily use and longitudinal observation. Plan/navigation/roadmap/README now distinguish a production-path personal build from a stable or public release. E52 host/manual gaps carry forward; frozen history and native binary remain unchanged.

This unit produces planning and editable vector identity concepts only. It does not change plugin runtime, stored data, package identity, install files or media architecture; no host/media benchmark is warranted. Selection is required before final branding. No new dependencies, remote push, distribution, library writes or source media operations.

Brand plan/critique: retain pale-blue/neutral identity, spend variation on five distinct silhouettes (folded M, margin bookmark, continuous trace, quotation pair, orbit/play mark). Avoid merely recolouring one icon; no glass/3D. A is strongest at small size, B communicates annotation best, C softens the identity, D trades immediate playback meaning for a quotation symbol, E is familiar but less distinctive. Local Segoe UI and optional Bahnschrift are preliminary wordmark references, not bundled fonts or a final custom wordmark. Final decision belongs to the user; no trademark clearance is claimed.

Artifacts: [brand overview](../../brand/motionote-round1/README.md), five SVG marks, responsive HTML board and SVG/PNG contact sheet. Ego browser verified five concepts and no horizontal overflow at1440px. Its normal screenshot and fallback captureScreenshot(fromSurface:false) both timed out; these are capture failures, not successful screenshot evidence. Exported an independent SVG board from the same paths through browser Canvas, labelled as vector export, then visually inspected the PNG: all five directions, dark/light contrast and16/24/32px samples present, no clipped labels. Browser task4 closed; user plugin-preview tabs untouched. No computer mouse control used.

Verification scope: documents/links/stage governance, asset count/XML structure and bounded output size; no runtime tests needed because plugin/native/tests unchanged. E52 real-host/4K/data/long-session gaps are explicitly carried into E53. Old five-user release plan paused; external publication/remote tags/independent app remain outside this unit. Evidence scripts under verification-runs/e53 are bounded local process records; final brand sources are versioned under docs/brand.
