已经确定**只在 Cloudflare 上做这个功能**（EdgeOne 那份保持原样跑测评+AI解读，不涉及登录）。

---

## 第一步：创建 D1 数据库并绑定到项目

1. Cloudflare 控制台左侧 **Workers & Pages** → **D1 SQL Database** → **创建数据库**
2. 起个名字（比如 `yourlover-db`），创建完成
3. 进入这个数据库 → **Console**（控制台标签页）
4. 把 `db/schema.sql` 里的全部内容粘贴进去，点 **执行**（Execute）
   - 这一步只需要做一次，除非以后要改表结构
5. 回到你的 Pages 项目 → **Settings** → **Functions** → **D1 database bindings**
6. 点 **添加绑定**：
   - **变量名称**：必须精确填 `DB`（代码里就是读取这个名字）
   - **D1 数据库**：选刚才创建的那个
7. 保存

---

## 第二步：注册 Resend，验证你的域名

### 2.1 注册账号

打开 https://resend.com，用邮箱注册（免费）

### 2.2 验证域名（必须做，否则只能发给你自己）

Resend 的免费沙盒发件地址（`onboarding@resend.dev`）**只能发给你注册 Resend 时用的那个邮箱**，对任意其他用户发送会失败。要让所有用户都能收到登录邮件，必须验证一个你自己的域名。

你之前申请的 EU.org 域名正好能用（假设是 `yourlover.eu.org`）：

1. Resend 后台 → **Domains** → **Add Domain**
2. 输入你的域名（比如 `yourlover.eu.org`，可以用主域名，不需要专门开子域名）
3. Resend 会给你几条 DNS 记录（通常是 SPF、DKIM 各一条，格式是 TXT 和 CNAME）
4. 去 nic.eu.org 域名管理面板，把这几条记录加进去（跟之前加 CNAME 记录是同一个操作界面）
5. 回到 Resend 点 **Verify DNS Records**，等待验证通过（一般几分钟到几小时）

验证通过之后，你就可以用 `login@yourlover.eu.org` 这样的地址发信了。

### 2.3 拿 API Key

Resend 后台 → **API Keys** → **Create API Key**，权限选 **Full access**，复制生成的 Key

---

## 第三步：在 Cloudflare Pages 配置环境变量

项目 → **Settings** → **Environment variables**，新增以下三条：

| 变量名 | 值 |
|---|---|
| `RESEND_API_KEY` | 你刚才复制的 Resend API Key |
| `MAIL_FROM` | 发件地址，格式如 `心镜 <login@yourlover.eu.org>`（域名必须是已验证的那个）|
| `DASHSCOPE_API_KEY` | 之前已经配过的阿里云百炼 Key，保持不变 |

Production / Preview / Development 都建议勾上，保存后 **手动 Redeploy 一次**。

---

## 第四步：测试

1. 打开你的网站，右上角应该出现"登录，保存我的测评历程"的链接
2. 点开，输入邮箱，点"发送登录链接"
3. 去邮箱查收（包括垃圾邮件箱），点邮件里的"立即登录"按钮
4. 会自动跳转回网站，右上角变成你的邮箱地址 + "我的历程" + "退出"
5. 完整做一遍测评，测完后报告会自动静默保存（不会有额外提示）
6. 点"我的历程"，应该能看到刚才那次记录，点开可以完整复现当时的报告和原始作答页面

---

## 关于数据隔离与安全

- 每条记录都绑定 `user_id`，读取时严格校验归属，用户之间的数据完全隔离
- 登录令牌一次性使用、15分钟过期；会话 Cookie 用 `HttpOnly + Secure + SameSite=Lax`，前端 JS 无法读取，防止 XSS 窃取
- 单个账号最多保留 200 条记录，超出后自动淘汰最旧的一条，避免免费额度被无限占用

## 关于费用

- D1：Cloudflare 免费额度是每天 500 万次读 + 10 万次写，这个项目的量级完全用不完
- Resend：每天 100 封 / 每月 3000 封，免费额度对一个人少量使用来说很充足

## 如果登录邮件收不到

1. **先查垃圾邮件箱** —— 新验证的域名初期容易被误判
2. **确认域名已在 Resend 验证通过** —— 后台 Domains 页面状态要是绿色"Verified"
3. **确认 MAIL_FROM 里的域名和验证的域名一致**
4. **查看 Cloudflare Pages 的 Functions 日志** —— 项目 → Deployments → 点最新部署 → Functions 标签页，能看到具体报错信息

## 如果点历史记录里的条目打不开 / 报错

1. 确认 D1 绑定的变量名精确是 `DB`
2. 确认 `db/schema.sql` 已经在 D1 控制台执行过

---
Powered by Justin
