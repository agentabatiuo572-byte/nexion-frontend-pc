# 设计演示头像

这 10 张照片复用主人指定的 3012 旧原型已有 Random User 来源，2026-10-06 下载并逐张查看；本地文件用于稳定展示，不在打开原型时请求第三方。仅是虚构演示账号的头像，不表示真实客服身份，也不是正式产品默认头像授权清单。

来源：旧项目 `app/components/domain-views/design-kit.tsx:403–409` 的 `photoUrl`。原旧版以姓名匹配性别，本设计不继承该推断：客户显式固定照片；客服新建根据明确选择的性别抽取，未指定使用合并图库。

| 文件 | 来源 |
|---|---|
| women-39.jpg | https://randomuser.me/api/portraits/women/39.jpg |
| women-87.jpg | https://randomuser.me/api/portraits/women/87.jpg |
| women-21.jpg | https://randomuser.me/api/portraits/women/21.jpg |
| women-85.jpg | https://randomuser.me/api/portraits/women/85.jpg |
| women-7.jpg | https://randomuser.me/api/portraits/women/7.jpg |
| men-40.jpg | https://randomuser.me/api/portraits/men/40.jpg |
| men-84.jpg | https://randomuser.me/api/portraits/men/84.jpg |
| men-75.jpg | https://randomuser.me/api/portraits/men/75.jpg |
| men-83.jpg | https://randomuser.me/api/portraits/men/83.jpg |
| men-82.jpg | https://randomuser.me/api/portraits/men/82.jpg |

正式实施使用平台自有或已获授权的人像图库与现有受控上传链路；服务端保存头像资产编号，列表/会话/资料/作者显示复用同一来源。
