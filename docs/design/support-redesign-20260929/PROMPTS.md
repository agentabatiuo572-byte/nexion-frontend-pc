# 生图提示词与来源

工具：内置 `image_gen`，全部为不透明 PNG。每稿均以独立调用生成；`referenced_image_paths` 为**风格参照或编辑目标**，并非生产数据。下列保留五稿的主提示词与后续精确修订要求。文中 `final-v1` 等中间稿仅用于说明生成链，不作为实现引用或本次提交资产；五张可交付终稿与原草图以 `ASSET-REVIEW.md` 为准。

## 1. 个人工作台 → `personal-dashboard-final-v3.png`

输入图：`personal-dashboard-draft-v1.png`（协调会话先行生成，S2 查看后编辑）；末次修订输入 `personal-dashboard-final-v1.png`。

主提示词：

> Use case: ui-mockup. Edit the supplied desktop Chinese customer-service dashboard screenshot as the direct layout and style reference, creating a polished final UI design image. Preserve its charcoal/navy enterprise shell, left navigation, six metric cards, main task table, recent conversations, bottom summary areas, lime primary actions, readable Chinese, neutral borders, spacious grid. Correct BUSINESS SEMANTICS visibly in the image: six metrics exactly 绑定客户、活跃客户、沉睡客户、待维护、待顾问回复、首次待联系. Explain 沉睡客户 as 客户账户超过设定时间未活跃, never 未联系. The sample data is illustrative only: use small '示例数据' label. In customer rows show only name or ID, last account activity, last contact, service status; remove all sex, age, city, photo portraits, wealth or other imagined attributes. Distinct tasks: 待顾问回复, 首次待联系, 待维护, de-duplicated by customer; one row can show multiple tags but one actionable customer. Explain a successfully sent human contact records 执行维护; only the customer's subsequent verified account activity records 重新活跃; 不再维护 stops proactive follow-up and needs reason, with client able to seek help. In the bottom summary show three distinct outcomes labeled 已执行维护, 已重新活跃, 不再维护, with concise accurate subtitles. The main task row action should be 联系客户 or 回复, never a '完成维护' shortcut. Exact typography should be clear and legible at desktop screenshot scale. Do not add a voice/video feature, assignment switch, algorithmic codes, fixed 30-day or 7-day policy, fake system facts. No watermark. This is a single usable screen, not a multi-screen poster.

末次精确修订：保留整屏，仅把“今日待办”筛选中的“待维护 11”改为“待维护 16”，与六指标同一去重口径。

独立审查后的终稿修订：B002 行“沉睡”旁补“待维护”，说明进入待办的真实原因；“已重新活跃”卡同显 12 个成功周期和 11 位去重客户，均标为示例。

## 2. 我的客户 → `my-customers-final-v3.png`

风格参照：`personal-dashboard-final-v1.png`。修订链：初稿 → 理由确认与恢复动作 → 停止后活跃说明 → 账户/维护双维度 → 恢复动作补回。

主提示词：

> Use case: ui-mockup. Create a NEW, clearly distinct desktop screen called 我的客户 (My Customers), using the attached image solely as a visual-system reference: same enterprise charcoal/navy shell, Chinese typography, neutral border cards, lime main actions and restrained cyan service accent. Replace the entire central content. Single realistic 16:9 high fidelity interface screenshot, not a poster. Left nav highlights 我的客户. Main pane: top title, search by customer name/ID, simple filters 全部、待维护、沉睡、暂停主动维护, then readable customer list table with columns 客户, 上次账户活跃, 上次人工联系, 维护状态, 待办, 操作. No age, sex, city, financial profiling, photo portraits or invented personal data. Use customer IDs only and plausible example dates under small 示例数据 badge. Show one selected customer and an open right detail drawer. Drawer sections: 归属顾问 / 上次账户活跃 / 上次人工联系 / 维护状态 / 最近客户消息. Show distinct buttons 联系客户, 不再维护, 恢复维护; 不再维护 opens a small clear confirmation region within the drawer requiring 理由 with cancel/confirm, explaining '停止主动跟进；客户仍可主动联系，归属保持不变'. Include indication that 恢复维护 is independent and only visible for paused customers. A paused example customer row can show 恢复维护. Make click targets visually obvious. Don't show a direct '完成维护' button: successfully sent human contact records execution, subsequent verified account activity records reactivation. Avoid policy numbers such as 30 days or 7 days, internal codes, agent reassignment, voice/video, giant glow, watermark. The image's Chinese labels must be accurate and legible.

精确修订要求：

1. 在详情抽屉打开“不再维护”的确认区，必填“停止原因”，显示“仅停止主动跟进；客户仍可求助，顾问归属不变”，提供取消/确认；暂停客户行显示独立“恢复维护”。
2. 底部说明改为“客户后续账户有效活跃才记为重新活跃；停止主动维护不计成功”，不写“自动转待维护”。
3. 将列表“维护状态”混放的账户活动与维护状态改为“账户 / 维护”双 chip；详情分别显示“账户状态：沉睡”和“维护状态：正常跟进”。
4. 再次补上 D004 暂停客户行的独立“恢复维护”按钮，保留其余内容。
5. 独立审查后补齐 F006–J010 各行的账户/维护双 chip，未知活动明确写“未知”。

## 3. 私聊会话 → `conversation-final-v2.png`

风格参照：`personal-dashboard-final-v1.png`。修订输入第一版会话图。

主提示词：

> Use case: ui-mockup. NEW distinct desktop customer-service chat screen titled 会话消息, use supplied dashboard only for visual language: enterprise charcoal/navy, lime primary action, restrained cyan service accent, neutral card borders, readable Chinese. Replace content with single 3-column operator workspace: narrow left conversation list, wide middle chat, right customer profile. Left list belongs only to signed-in advisor's own customers; include filters 全部, 待顾问回复, 待客户回应 with one selected item 客户 A001, small unread indicator. Middle shows customer and advisor alternating text bubbles plus one received image thumbnail card; exact relationship 1v1 and current advisor's identity fixed, no identity switch. Header status '专属顾问 · 当前会话' and a plain small note '离线时消息留给原顾问'. Composer has text area, attachment image button, lime 发送; show one image upload failing inline with '上传失败 · 重试' and one outgoing message failing inline with '发送失败 · 重试'. Clear pending response status should be determined by latest message, read does not equal replied. Right profile shows 客户 ID, 归属顾问, 上次账户活跃, 上次人工联系, 维护状态, 最近服务记录. No age/sex/city/wealth data. Show illustrative-data badge. No audio/video/call buttons, no transfer-to-other-agent button, no old advisor proxy sending, no internal code, no fixed policy numbers, no decorative glow or watermark. This is a usable 16:9 high fidelity UI screenshot with readable labels, not a collection of screens.

精确修订要求：客户 10:12 消息只保留客户原文，不能包含“我：”；客户资料将“待客户回应”置于“会话状态”，另列“维护状态：正常跟进”；失败发送不改变最后成功消息决定的会话状态。

独立审查后的终稿修订：输入文字为空且只有上传失败附件时“发送”禁用；右栏改为“按最后成功发送的消息判断”。

## 4. 主管待绑定池 → `supervisor-pool-final-v1.png`

风格参照：`personal-dashboard-final-v1.png`。修订输入第一版主管图。

主提示词：

> Use case: ui-mockup. NEW distinct desktop screen for a customer service SUPERVISOR, titled 待绑定客户池. Use attached screenshot only as visual style reference: enterprise dark charcoal/navy, readable Chinese, neutral panel borders, lime primary action, restrained cyan service accent. Single usable 16:9 interface screen. Left nav includes 主管工作台, 待绑定客户池 (selected), 顾问负载, 会话审阅, 服务规则 (read-only to supervisor). Main summary cards: 待分配客户, 有留言客户, 最久等待; mark all numbers 示例数据. Main table has selection checkboxes, columns 客户ID, 入池原因 (无人可继承 / 邀请人未绑定 / 继承层数已达上限 as human words), 等待时间, 客户留言, 操作; visible row-level '分配' and one separate '批量分配已选 2 位' action. Do not imply all filtered results selected. Open right allocation drawer showing clearly '本次分配范围：已选 2 位客户' and list their two IDs, target advisor selector with advisor name, assigned-customer count and current conversation load separately (no arbitrary hard capacity), reason input, and text '每位选中客户成为新继承段 0 层；未选中客户不变'. Show confirmation and cancel. Customer messages can be held while awaiting assignment; no agent silently assigned on busy/offline. Indicate only supervisors may allocate; ordinary agents cannot. No internal engineering codes, no gender/age/city/financial profile, no fixed maximum depth number, no voice/video, no fake compliance, no watermark, no large glow. Readable operational UI, one screen only.

精确修订要求：主管分配是需审计的动作，把“分配原因（选填）”改成“分配原因（必填）”并显示必填标记。

独立审查勘误留在 `UI-INTERACTION.md`：表头应半选；空理由时确认禁用并提示 8–200 字。当前 PNG 的这两处控件状态只作为布局位置参考。

## 5. 超管服务规则 → `service-rules-final-v2.png`

风格参照：`personal-dashboard-final-v1.png`。修订链：未配置确认禁用 → 按 S1 契约增加 W 活跃统计窗口。

主提示词：

> Use case: ui-mockup. NEW distinct desktop SUPERADMIN customer service configuration screen titled 服务规则, using attached dashboard ONLY for visual style: charcoal/navy enterprise shell, restrained lime main action, neutral borders, readable Chinese. Single usable 16:9 UI screenshot, not multiple screens. Left nav highlights 服务规则 with clear '超管可编辑' role chip; supervisor and ordinary advisor view is read-only. Main rule form has three separate controls: 沉睡判定天数 (numeric stepper, currently 未配置); 主动维护间隔天数 (numeric stepper, currently 未配置); 最大自动继承层数 (number stepper, currently 未配置) with separate '不限制' toggle. DO NOT display 30天/7天/2层 or any invented saved values; show 未配置 until authoritative settings are loaded. An inline status banner says '规则尚未配置；完成设置并确认后才启用自动判定'. Right panel shows 影响预览: '沉睡与待维护标签可按新阈值重新计算；已有顾问归属及待绑定池记录不自动重排；最大层数仅作用于之后的新注册判断.' Bottom shows '保存设置' opening a compact confirmation card with required '修改理由' input, clearly listing only changed fields (placeholder example labels, no fake numeric values) and '取消' and '确认保存' buttons. Numeric controls should look like normal input/stepper, not freeform compound field. Include a small read-only role view cue. No algorithmic codes, fake policy data, voice/video, demographics, giant glow, watermark. Visually clear and implementable.

精确修订要求：把沉睡解释改为“超过设定天数无有效账户活跃”；所有字段未配置时确认框写明“尚未填写规则，暂不能保存”，差异显示“未配置 → 待填写”，确认按钮禁用。按 `CONTRACTS.md` 再增加第四项“活跃统计窗口天数 W”，说明与沉睡状态分别计算，并纳入未填写差异列表；不编造默认数值。

独立审查勘误留在 `UI-INTERACTION.md`：L 的说明改为人工根 0 层向下继承；部分规则可单独保存；“当前为超管视图”只是静态身份标识。当前 PNG 的这几处文字/控件状态只作为布局位置参考。
