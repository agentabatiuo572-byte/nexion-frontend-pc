# CGM-I · 内容合规CMS(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 9 行。

| id | scope | type | frontendField | opsPurpose | crudActions | MC | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-I-001 | per-user | param-config | useLocale.code / setLocale / userSet | content_compliance,platform_integrity | 运营按区域配置默认语言与可用 locale 集合;核查 i18n 内容覆盖度(en/zh ~770 keys 镜像) | · | 读+写(用户) TBD·建议 GET/PUT /api/me/locale;目录 GET /api… | gap |
| CGM-I-002 | per-user | data-CRUD | useProfile.displayName / bio / region / timezon… | platform_integrity,content_compliance,r… | 运营审核并强制修改/清空违规昵称或简介;封禁不当头像;按地区合规标记账户;核对 region 与实际管辖 | · | 读+写 TBD·建议 GET/PUT /api/me/profile;审核 POST /api/a… | gap |
| CGM-I-003 | platform | param-config | CATEGORIES[] / FORMAT_LABEL (learn taxonomy) | content_compliance | 内容运营增删分类、调整分类标签/配色/emoji、维护格式枚举 | · | 读+写 TBD·建议 GET/PUT /api/admin/cms/learn/taxonomy | gap |
| CGM-I-004 | platform | data-CRUD | complianceBanner (title/body/cta) | content_compliance,platform_integrity,r… | 合规运营开/关该横幅、编辑文案、配置展示时段(监管抽查期上线、过后下线) | Y | 读+写 TBD·建议 GET/PUT /api/admin/cms/compliance-bann… | gap |
| CGM-I-005 | platform | data-CRUD | kycExpress (heroTitle/why/steps/trust partners … | content_compliance,fund_safety,platform… | 合规运营编辑 KYC 说明文案、触发阈值描述、合规伙伴信息、FAQ;监管要求时更新管辖与免责措辞 | Y | 读+写(文案) TBD·建议 GET/PUT /api/admin/cms/kyc-express… | gap |
| CGM-I-006 | platform | data-CRUD | LESSONS[] (id/category/format/title/subtitle/du… | content_compliance,conversion,network_g… | 内容运营增删改课程条目、调整 rewardNEX 奖励、设置 featured 置顶、上下线课程;按合规要求修订安全/风险类课程文案 | Y | 读+写 TBD·建议 GET /api/learn/lessons + PUT /api/admi… | gap |
| CGM-I-007 | platform | data-CRUD | riskDisclosure (navTitle/heroTitle/heroSubtitle… | content_compliance,platform_integrity,f… | 合规运营增删改 7 段披露正文、勾选确认文案、披露 navTitle/hero;按地区监管要求更新提现窗口/罚则/管辖等措辞;新增披露段落 | Y | 读+写 TBD·建议 GET/PUT /api/admin/cms/risk-disclosure… | gap |
| CGM-I-008 | platform | data-CRUD | trialDiscloseTitle / trialDiscloseBody / trialD… | content_compliance,fund_safety,conversi… | 合规运营编辑自动扣款披露措辞与实付金额占位文案;确保披露与 TrialConfig 实际扣款规则一致 | Y | 读+写(文案) TBD·建议 GET/PUT /api/admin/cms/trial-discl… | gap |
| CGM-I-009 | platform | data-CRUD | trust / trustCenter (trust center subtree: trus… | content_compliance,platform_integrity | 运营增删改信任中心条目(审计报告链接、合作伙伴、合规备案号、联系邮箱);更新审计周期表述 | Y | 读+写 TBD·建议 GET/PUT /api/admin/cms/trust-center | gap |
