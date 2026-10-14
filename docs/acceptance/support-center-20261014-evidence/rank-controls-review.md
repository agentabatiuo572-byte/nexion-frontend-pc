# 本轮业绩榜控件与PNG输入独立验收（2026-10-14）

范围：只读审查共享 support-leaderboard.css 与 tests/support-leaderboard-fidelity.mjs、.test.mjs、support-leaderboard-runtime.mjs 的当前差异，实际查看 rank-layout-final.png、rank-pagination-menu.png、rank-long-identity.png；核对本批浏览器JSON。产品TSX、排行榜业务、权限和服务端不在本次修改范围。未运行浏览器、测试、数据库、构建或Git修改。并行出现的交付文档不作为本次产品代码验收范围。

## Findings

最终当前快照：P0=0、P1=0、P2=0。初审发现1个P2测试契约残留，主线已最小修正，下述回源关闭记录保留。产品源码/截图未发现P0/P1/P2。

### R1 / P2（已关闭）：分页关系布局已经更新，运行脚本原用旧纵坐标硬下界

位置：FE/tests/support-leaderboard-runtime.mjs:106，approved-layout-geometry 最后的逐按钮断言仍为 b.y>=891 && b.y+b.height<=934。当前 compact-controls-browser.json 的实际页码按钮 y=889.333374、height=42、bottom=931.333374；按钮组也在 y=889.333374。这满足当前分页容器内居中及条数/翻页右侧同组的批准布局，但该旧下界必将拒绝它。前面的容器几何使用±2容差，会接受相同位置，因此不能靠前面关系断言关闭这一残留。

建议最小修正：逐按钮核位于当前分页容器/按钮组边界内、宽高有效，并保留条数与按钮组20px间距、中心对齐和左右分组断言；不要恢复旧translateY(2px)或放宽整套几何来迁就旧坐标。本结论是源码加现有DOM记录的确定性比较，没有自行运行整套脚本。

## 当前证据与源码核对

- CSS SHA256：14824ef61e4c4576e8fedd5b1a6319fb5101f0c55a23643d37327a93200376a8，独立读取当前文件与capture/select记录相同。runtime初审SHA256：4c5fe1bc27dede019b9fac10161257550ef6d4149201a6750d08318b930ebd71；修正后最终SHA256：90a52516a0e4a412c9ce0baf5e1f95835247130b805f8bb139a47d761bda24e6。
- 实际逐张看图：1536完整画面的姓名/组名区域与尾列标识分离；“我”和涨跌跨两行居中；分页总数在左、条数与翻页在右；定位按钮紧凑且文字/图标可辨。分页展开图为主题菜单，向上避让触发器；长姓名与长组名截图保留省略且未压到标识。局部截图裁边不视为页面横向溢出。
- badge-spacing-browser.json 共3宽（1536/1000/390）×3状态（普通/长名称/未知）、45行：overflow全部false，标识与姓名/组名框最小gap=12.000008px，整行中心最大误差0.166748px；长状态所有行姓名及组名均省略。该记录早于后续只改控件的CSS；最终长名图再次显示五行无交叉。grid的minmax(0,1fr)与两尾列、两行跨度直接对应要求；display:contents没有移除实际姓名按钮或原回调。
- select-style-browser.json 共8个实际菜单（1536/390×四控件）：appearance=base-select、展开状态true、箭头居中/右内距14px，选项14px、最小36px，长项窄屏换行为56px；记录的每个选项位于对应宽度及1024高视口内。四控件实际键盘选值分别NEX/2026-09/mine/10，另有disabledOptionSkipped=true。CSS保留原生option禁用与select回调、supports外原生回退、锚定及flip避让；runtime键盘事件改送实际焦点，Esc关闭/回触发器由源码断言与主线交互报告支持，JSON没有逐个持久化Esc焦点字段，本独审不伪称独立重放。
- compact-controls-browser.json 记录实际定位点击focusReachedTable=true、112×36/14px字体/16px图标；分页summary x222.667、条数框x1011.333、按钮组x1185.333，20px间距且中心相同，右界1495.333在容器1516内。触屏附录rank-controls-touch.json为coarse=true/height44；这是浏览器粗指针模式证据，不是物理触屏设备验收。hover/active及既有focus-visible样式保留。
- rank-layout-capture.json绑定同CSS、fonts loaded、imagesReady、reduce=true、1536×1024显式scale1；DPR约1（浮点1.0000000298）。独立检查最终PNG八字节签名与IHDR1536×1024，截图SHA256=87dfe72efbc4b4324d4c7dc9b2ff051411dd74f26c37db418cc6d4a7be380d04，与仓内manifest相同。记录明确browser-fixture；未把当前画面当成真实完整榜。

## PNG guard复用与边界

复用RANK-FIDELITY-CONTRACT-20261014.md内前轮guard只读结论：helper/test文件未变，当前SHA分别efe960bd56a03284eee9ce0e84e740952a610f83f7066a67bff4ec8cfdbb03e0、51220e85d6d5ece0c4a7deb8a234094486f207fa9250769066bd436814fc353a。PNG签名在sharp解码前检查，runtime原图和实景图均经过helper再做颜色比较，损坏输入继续报错；JPEG伪装PNG反例不被文件后缀绕过。既有RGBA/尺寸、原阈值及mask没有放宽。前轮9/9来自主线，本次未重复。PNG可解码不单独证明从未JPEG转码或后处理；本次原始捕获记录与hash另承担来源证明。

本批仅证明共享产品组件受控数据画面及对应控件交互。没有再次证明真实M6异步跨页、403取消、数据库持久化、正式账号/真实榜单完整发布；这些与此前真实服务证据分层，不能互相代签。未验不支持base-select的旧浏览器主题外观、物理触屏或不同系统原生菜单；源码保留原生选择回退。主线说明console0，但本次四份核心JSON没有独立保存错误数组，不以此写成独立复跑零错误。

整幅原稿像素验收仍NOT_PASSED。此前边缘阶段raw237067→234948及九ROI=0不是最终全幅通过；不为本批新截图臆造raw结果。三榜、六列、姓名后标识、共同单位、绿色圈、紧凑定位及分页分组为已批准变化，不恢复旧四榜/七列/坐标来凑0，也不通过全表mask或九ROI代签全幅。

本轮看了最终三张图并核了控件记录；界面范围未发现产品缺陷，旧测试坐标问题已回源关闭，整幅像素与跨平台未验范围保留。

## 最终回源关闭与补证

主线修正后独立重新读取runtime:106：旧891/934硬边界已移除；每个翻页按钮核分页容器纵向边界、按钮组横向边界、有效宽度，并与按钮组中心对齐，原分页左/右布局与20px间距约束继续保留。当前按钮y889.333/bottom931.333在容器879.333～942内、中心与组相同，旧坐标假红已消除；R1关闭。CSS SHA未变，不重新代签产品或整套runtime。主线提供11/11定向233ms及语法exit0，本独审未重跑。

另读取P/touch-locate-browser.json，coarse=true/height44与源码一致；读取P/rank-controls-movement.json，右移后的排名说明inside=true且escapeClosed=true，未因grid尾列布局阻断原说明入口。该补证仍为共享组件fixture，不证明昨日数据来自真实发布基线。长范围选择的98px及42px右内距为主线交互报告，本独审不将未持久化字段冒称单独测得。

最终只对上述源码hash与现有受控浏览器证据报告“无P0/P1/P2 findings”；不是整幅像素、全运行时或真实消息链完成签名。
