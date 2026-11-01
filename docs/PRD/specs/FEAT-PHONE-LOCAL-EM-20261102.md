# 手机本机 EM 与派单资格

日期：2026-11-02。状态：候选实现、桌面引擎、HBuilderX 5.33真机整模型及下载缓存预验已完成；正式Android APK、正常云包和手机收益完整链路仍待实际验证。不得据此宣称已经发布或正式真机验收通过。

## 用户问题与预期

手机显示Online但长期无任务时，必须显示可核对的未派原因。账号槽位、手机绑定、校准分数、运行心跳与真实本机执行能力分别判断；Online或校准成功不能代替任务执行。

本轮初始盘点3778账号手机1383的绑定、ACTIVE/MATCHED校准、有效APP执行安装、47%电量、联网和新鲜心跳均正常，且从未有任务。旧路由把手机内存映射为7GB路由值，当时EM最低门槛为8GB，旧版App也没有本机模型执行器。因此不能通过重新绑定、伪报8GB显存或把云端BGE-M3任务标为手机完成解决。

## 当前手机能力合同

Android App提供CPU本机EM（Embedding）执行，正式模型名称为 `all-MiniLM-L6-v2`；UI任务类别仍显示产品类别全称。模型不是BGE-M3，也不宣称NPU/GPU计算。iOS与H5当前只查看手机资格、任务及收益事实；H5不挂载执行器，不能向手机执行入口申报已就绪。

手机EM按真实CPU/RAM和已加载执行器适配，专用配置 `minVram=0`。该配置不放宽IG/VG等其他类别的硬件门槛。校准分数仍是平台校准值，不转换为实测本机吞吐。只有固定模型SHA校验和真实ORT session加载成功后，App才向服务端申报引擎已就绪；服务端按当前绑定APP执行owner和120秒有效期回读能力。

固定资源：ONNX Runtime Web `1.23.2`；官方MiniLM revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`，FP32 ONNX文件90,405,214字节、SHA256 `6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452`。安装profile digest为 `sha256:4fd205f37776262f8e8d3224ce5a4ed0b19bd106129046da04322a6bd19b4562`，它与模型权重摘要分别校验。模型峰值RAM小于0.5GB是实机验收门槛，文件大小不能替代峰值测量。

正常APK/WGT仅包含ORT、Worker和许可证，不携带90MB权重。首次在Android App前台准备时从固定官方HTTPS revision下载，显示进度；用原生保存能力写入App私有持久缓存，按revision和SHA复用，后续启动及任务不重复下载。每次使用缓存仍由真实Worker核对完整权重SHA，失败时不可接单并提供重试。HBuilder缓存与正式APK缓存分别验收，不用调试壳下载成功替代正式包首次准备。

HBuilder预验已证明首次真实下载90,405,214字节并保存为 `_doc/uniapp_save/<timestamp>.onnx`；完整进程重启后复用同一缓存、新增下载0字节。两次生产Worker推理199ms/202ms（仅推理耗时），完整产物相同且分别独立复算通过。下载中切后台后失败的准备标志已最小修复，前台重试实景仍待后续整体流程，不以代码检查记通过。

## 执行与独立确认

服务端冻结2条文本对应的token IDs、attention mask、token type IDs。基础模板每条最多120token；每单在两行CLS之后分别加入8个服务端随机词表ID，并同步mask=1、tokenType=0，最终每条最多128token。完整挑战矩阵进入manifest及inputHash；App直接计算收到的矩阵，不能自行改输入或把旧向量重新绑定新任务。Android App在renderjs桥的Worker中以WASM CPU单线程真实执行encoder、masked mean pooling及L2归一化，产出little-endian float32 `[2,384]` 共3072字节。ORT、Worker和许可证随正常native构建打包；模型权重只从固定官方HTTPS revision首次下载到App私有持久缓存，每次使用仍由Worker核完整SHA，不随APK/WGT打包，不使用云执行产物冒充本机输出。

独立服务端进程加载同一固定ONNX模型，复算冻结输入并比较完整向量、形状、有限数值、摘要与task/generation/input/model绑定。客户端耗时和metrics不是验真权威。只有验证通过才进入既有VERIFIED事件、MQ及分钟结算；不能以本机倒计时、HTTP任意2xx或固定向量触发收益。

手机普通APP会话使用 `/api/app/compute-v2/phone/{next,heartbeat,complete,receipt,exited}`。服务端从当前会话确定手机绑定，不允许App指定别人的device/owner/installation，不向App下发云runner凭据。云执行器不能领取手机runtime，手机不能领取其他设备队列。

## 中断与结果未知

App按账号和安装实例保存本地任务journal：next前保存CLAIM_INTENT，推理前保存COMPUTE_INTENT，输出后先保存完整原bundle再提交。提交响应未知时仅回读或重传原bundle；不得重新推理已处于未知结果的任务。恢复时发现旧COMPUTE_INTENT先结束原代际，不重复执行。

低电（小于20%）、断网、后台或离开当前会话时停止新领取，实际终止Worker后才报告退出。未完成与已验证的退出分开处理；停止UI动画不能当作Worker已退出。结果身份、完整回执或退出确认未核实前不开始下一代际。恢复联网/前台后按原journal核对，不把历史未知任务重新随机派单。

## 用户展示与验收

收益页、手机详情和设备仓库展示绑定、校准、有效APP执行会话、运行心跳、电量、联网和引擎未就绪等具体原因。本机状态区分准备模型、已就绪、等待任务服务、本机计算、服务端校验、任务状态恢复、暂停与暂不可用。尚未获得真实任务时，接口错误显示“任务服务暂不可用，等待重连”，不显示恢复任务或结果。引擎未就绪时不继续显示假性“等待新作业”或建议提升手机显存。既有账号设备、历史和收益事实继续可读。

现有真机SM-A5760/Android16、arm64、约7.26GiB系统内存与WebView156已连接；当前手机界面运行于HBuilderX 5.33对应的Android标准调试基座 `io.dcloud.HBuilder`，已安装的正式 `ai.uvel.app` versionCode2026110101当时未运行。HBuilder运行结果与正式APK结果必须分列。

已运行：桌面浏览器通过生产Worker生成真实MiniLM向量，独立PythonORT复算通过，最大误差约1.2×10⁻⁷；将向量篡改并重算产物摘要后，独立复算仍拒绝。此证据不替代Android实机。

已运行HBuilder真机模型预验：SM-A5760上真实生产Worker计算2×16token矩阵（每行含8个随机挑战ID），首个取证样本185ms；取回完整3072字节后，独立PythonORT复算最大误差9.6857548×10⁻⁸、最小余弦1。旧向量重绑正确新task/input/binding并重算摘要仍被独立复算拒绝。本次不领取业务任务、不结算；临时烟测入口验证后删除。观察到的全WebView进程内存不等于模型增量峰值，RAM门槛仍待正式流程实测。

正式通过需正常发布的Android APK在真实手机完成领取→本机推理→服务端独立验真→分钟入账→下一单，并实际覆盖一次中断恢复、非owner拒绝和错误产物拒绝。当前未运行的分支保留待验，不能用桌面H5、HBuilder调试或云端任务代替正式手机验收。
