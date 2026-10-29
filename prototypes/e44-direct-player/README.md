# E44 A：直接播放技术关

用户已批准的隔离原型，不由正式播放器引用。只读锁定的已有77秒4K素材，不写素材库、标注或正式缓存。没有代理生产、抽帧或备用显示链路。

`prepare.cjs`验证源/工具SHA并读取完整压缩包索引，证据和本机配置仅写`verification-runs/e44`。`direct.js`执行WebCodecs源解码、最新意图、按PTS确认及有界独立目标画布缓存；源VideoFrame输出立即关闭。`worker.js`为浏览器DedicatedWorker，不使用Eagle不支持的Node worker_threads。`gate.js`同窗口比较原生video与直接解码，保留取消分母和准确帧检查。`host.js`当前为最后一次单轮、2包队列诊断，非验收运行；首次三轮结果见报告。`index.html`用于Eagle隔离窗口；独立Chrome结果不得替代宿主结果。

A关尚未通过，详见`docs/experiments/E44/report.md`。不要直接接入正式播放器，也不要自动重复试验或安装原生依赖。

原片的完整音频、其它编码/旋转、整片代理和正式标注接入仍在后续关卡，不因这个原型打开就称已完成播放器。原型不会访问Eagle素材API，也不会触发正式任务守护。
