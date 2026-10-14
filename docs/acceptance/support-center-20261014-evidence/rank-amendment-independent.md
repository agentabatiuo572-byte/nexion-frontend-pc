# 排行榜批准变化验收独审（2026-10-14）

主人，本轮只读审查 FE `D:/WORKS/PLAN/.wt/cs-analytics-ui-20261007`，基线 HEAD `8fce45b559470dfe9a7ad2ddfbff05f99788b80d`。范围为 fidelity.mjs/.test.mjs、runtime.mjs、support-leaderboard.css 四个未提交文件。没有源码修改、浏览器、构建、数据库、完整门或远端操作；仅运行无服务/落盘副作用的内存像素反例，按明确授权只写本报告。

当前结论：P0=0、P1=0；发现两个 P2 验收覆盖缺口。主线正在补充，最终实景证据尚待提供。本报告不宣布页面像素通过或整体完成。

## 发现及复核

### AMEND-01（P2）：表线绘制曾仅由盒子代验；底边仍需覆盖

原位置：fidelity.mjs:153-157、169-185；runtime.mjs:81-85。窄带像素全部跳过，初版只读取 th/tr 盒子，不查表线宽度/样式/颜色。表线变黑、透明或不绘制均可保持相同几何；合法六列盒子并不能接管线条像素。

独立内存反例：把 [675,700] 的一个通道由128改为0，raw changedPixels=1，amended changedPixels=0，geometryChecked=true；[720,720] 普通表面坏点仍得到 amended changedPixels=1。初版 `.test.mjs` 只列几何/圈反例，遗漏表线样式反例。

主线已补源码：当前 fidelity.mjs:186-198 强制36个 th/td 盒子和每个 left/top 的边线宽度、solid、rgba(39,50,54,0.5)，runtime.mjs:83 从实际 DOM 提取；测试新增单元格移位、错误宽度/色值/样式拒绝。因此内线样式遗漏已在源码层接管，待当前实景记录复核。

剩余同形点：horizontal列表含源末线878/新末线879，导致 x204..1514、y877..880 均为 amended。源PNG在y878有实际底边亮线（x500 RGB25,31,35；上y877 RGB14,18,21，下y879 RGB11,14,17）。当前36cells检查的 left/top 不包含该末线。若末线是批准迁移的行结束线，应独立核底边绘制；若属于未批准外框，应留在旧图像素门。不得用其余背景像素或table盒子代替。

### AMEND-02（P2）：圈样式正确并不保证圈实际可见

位置：fidelity.mjs:199-208；runtime.mjs:83、all-award-frames-green-and-moving 约225-239。当前 frame 只核盒子、border2px/solid/绿色、圆角和shadow；没有核frame或祖先的 opacity/visibility 等实际可见性。现动效哨兵只读 ::after 的opacity、animation和transform，父frame opacity=0 时这些仍可以保持正确。

独立内存反例：在合法frame记录额外加入 opacity=0、visibility=hidden，assertApprovedAmendmentGeometry仍接受；把已豁免圈像素 [662,198] 改坏，raw changedPixels=1，而amended changedPixels=0。此例证明当前几何数据不能拒绝隐藏圈；没有运行浏览器去伪装为产品现有故障。

建议：实际DOM采集frame和相关祖先可见性，断言未隐藏、opacity有效，再用一个隐藏frame反例拒绝；或对批准绿色圈增加有界实际paint检查。保持现有环带，不因反例扩大mask。

## 已确认的正确连接与边界

- 原raw逻辑仍逐像素检查其固定static集、保留changedPixels/maximum/firstDifferences；runtime独立写full-static-coverage.json，并明确标旧图诊断FAIL。没有把原raw失败强写为通过。
- amendment以固定源/批准几何坐标生成，未读取差图反推区域。70698 amended面积写死且assert；剩余static超过1200000、全幅分类面积守恒，未发现全表/整列/全本人面板蒙版。
- amended结果只有 changedPixels=0 才能写自身PASS；assert仍要求maximum<=1且changedPixels=0。异常进入check fail，最终report和退出码由所有失败检查汇总，九ROI不能替代此门。
- geometry来自实际page.evaluate，而非直接把单元测试预期喂给runtime。额外 approved-layout-geometry 会检查30个 td、分页分组/边界、定位我112x36和全部六导航图标/文字锚点。
- CSS仅在min-width1451px分支将导航左padding改21；移动端既有规则不受这条媒体查询覆盖。当前源码没有额外视觉改动。x70/icon26是否实际达到须由本轮实景证明，不能凭减4px推断通过。
- runtime对原批准PNG及static截图均用PNG签名guard、sharp RGBA解码，同尺寸及byte数断言保留。reference固定hash及素材manifest门保留。新amended检查本身没有替换gold。
- 结果top-level report仍含raw fullStaticCoverage；amended在独立JSON和对应steps.evidence内。消费方应取同runId/output、当前testFileHashes的amended结果，不能只读顶层raw误当新门结果。

## 检查范围说明

这是指定四文件的本地审查，staged无改动，不属于PR审查；没有PR merge readiness可核。未新增TypeScript代码、没有canonical typecheck/lint script，eslint可执行文件也未安装；按本轮约束没有重新运行仓级tsc/verify/构建。主线先前11/11单元结果仅作为提供的证据，不冒称独立重跑。

done-review六维在本只读范围的口径：真落地=核实际函数/调用及内存反例；应有项=原批准变化逐项核对；交互=仅读现有布局/操作门，未签实际操作；同形=两类amended绘制层均查并补列末线；不变量=raw/严格非amended/full-area/DPR及PNG输入门保留；实景=等新记录，不据静态审查签产品验收。

本轮查了四文件的验收连接与反例，确认两处P2绘制覆盖缺口并交主线补齐；页面像素是否通过尚未签认，无需主人新增拍板。

未检查完整构建、浏览器、数据库、全站及PR合并状态；本报告不能当页面或整体任务完成证明。

## 最终复核追加（2026-10-15；覆盖上文初审时的开放状态）

本次只复核 AMEND-01/02 修补、六导航对齐、分页布局及同一快照/PNG，不扩大产品审查。当前这次合同补丁范围：open P0=0、P1=0、P2=0；AMEND-01、AMEND-02关闭。此结论只签这两处验收缺口已接管，绝不签全图或整体完成。

### 两P2关闭的证据

- AMEND-01：fidelity.mjs:186-199现强制36cells的盒子、visible=true、每条left/top的宽度/solid/rgba色值；runtime.mjs:83-84逐个从DOM真实采集。末线878/879从horizontal豁免列表删除（fidelity.mjs:156）；[500,878]、[500,879]回到classification0。新增单元反例明确破坏外框像素仍需报1个changedPixel，未将底边推定为已批准变更。固定amended由70698收紧为65484，没有扩大mask。
- AMEND-02：fidelity.mjs:202-212的六frame和上述cells都强制visible=true。runtime.mjs:83的visible函数从节点遍历全部祖先，display=none或visibility非visible立即拒绝，opacity相乘必须严格等于1。父frame/祖先opacity0不能再只靠::after的opacity1冒充可见。当前geometry记录36cells及6frames全部visible=true。
- 独立离线检查：使用真实geometry分别变异cell.visible=false、frame.visible=false、cell.left.color黑色、cell.top.style=none，四次均被assertApprovedAmendmentGeometry拒绝。同步核底边两坐标classification0。没有起浏览器或写fixture伪造实景。
- 主线提供11/11定向测试、352ms；本复核读取了相应源码反例并运行上述更小内存自检，没有重复完整测试门。

### 当前截图、记录及快照连接

证据目录P：`D:/CodexData/test-environments/workflow-runs/support-analytics-20261007-r2/runtime/support-minimal-20261012/pixel-alignment-20261014`。

已离线查看rank-amendment-current.png，头像圈可见、六导航文字同起点，页脚左侧总数与右侧每页条数/翻页分组无重叠。PNG通过现有签名guard并解码为1536x1024、RGBA四通道、6291456 bytes；SHA256=`c0c4309488622c1e677f0f8877a09425a037344064e2d8866360fece7a796017`。原批准PNG SHA仍为`e3b92e2fbb593171a4658e058c562ec4dbc9403fecafdf8dd85a719ba71f6c3a`。

rank-amendment-pixels.json.geometry与rank-amendment-geometry.json逐字段deepEqual一致；其snapshot四项与本次实际文件hash逐项一致：

| 文件 | SHA256 |
|---|---|
| support-leaderboard.css | 34d39a9fa63b95077260708c58fa2b8e1b3b85c1a9be0d3a30f925dd4b06b009 |
| support-leaderboard-fidelity.mjs | a2ad978530c70b54777f69ecf8a8b340e9064d8c20e2f2cfe714036eaf58035b |
| support-leaderboard-fidelity.test.mjs | a37e2249b9fb9f366e17017c4470a7b0a4a939472e31591c875f47e87f917d44 |
| support-leaderboard-runtime.mjs | e8393097d2166cb327ec6c63d76511d3f79aa38a12dcc15e7a42e80ba2ef93ce |

独立用当前helper、源PNG、当前PNG、真实geometry离线重算；raw与amended的全部返回字段（不仅changedPixels）均deepEqual报告对应字段：raw changedPixels=244995；amended changedPixels=190593、maximum=255、static/checked=1225462、dynamic=281918、amended=65484、uncovered=0。总面积1572864守恒；报告verdict明确FAIL，没有被改为PASS。剩余差异的来源/是否已批准不在本次两P2复核范围，不能靠本报告豁免。

### 导航与分页

六导航记录均text.x=69.6666717529、icon.x=25.6666679382，对x70/x26目标偏差约0.333px，落在既有2px几何范围内。截图所见文字左边与提供的批准稿亮边x70/71目标相符；这里只确认导航锚点修正，不证明全部字形像素一致。

分页：pageSize x1011.333374、width154、height41；pageButtons x1185.333374、width310、height42；独立算两组间距19.999999999999886、中线差0、右侧内距20.6666259766。截图左侧总数在左，条数选择与翻页在右，间距和纵向对齐清楚。旧图与当前批准布局差异仍由总体FAIL保留，不借这一布局确认关闭像素残差。

本輪复核了两处验收缺口，补丁已把反例拦住，导航和分页证据一致；全图像素仍FAIL，无需主人新增拍板。

未另跑浏览器、构建、数据库、全站或完整门；未认证其它剩余像素差异，此报告只关闭本次两P2。
