# 部署说明：EdgeOne + Cloudflare 双平台备份 + EU.org 免费域名

## 仓库结构

```
你的仓库/
  ├── index.html               前端页面，两个平台共用同一份
  ├── node-functions/
  │   └── analyze.js           只给 EdgeOne Pages 用
  └── functions/
      └── analyze.js           只给 Cloudflare Pages 用（备份平台）
```

两个函数文件逻辑完全一致，只是写法规范不同（EdgeOne 用 Node.js 风格的
`process.env`，Cloudflare 用 `context.env`），因为两个平台的边缘函数运行时不兼容，
所以各自保留一份，不需要你手动同步内容，除非以后要修改 AI 分析的 prompt 逻辑，
那时候需要两个文件都改一遍。

`index.html` 请求的是相对路径 `/analyze`，不管你访问的是 EdgeOne 域名还是
Cloudflare 域名，都会各自路由到对应平台自己的函数，不会串线。

---

## 第一部分：申请 EU.org 免费域名

因为不方便实名认证走国内备案通道，这里用 EU.org 的免费二级域名
（不需要身份证实名，面向全球用户）。

1. 打开 https://nic.eu.org/
2. 点 **Register**，填邮箱、用户名、密码，完成验证码
3. 登录后点 **Apply for a domain** → 选择 **Second-level domain**
4. 输入你想要的前缀（比如 `yourlover`），会生成 `yourlover.eu.org`
5. 用途说明必须用英文，例如：
   ```
   A personal psychology quiz web application for self-exploration,
   built with static HTML and serverless functions for AI-powered analysis.
   Non-commercial personal project.
   ```
6. 提交，等待人工审核，通常 3-7 个工作日，通过后邮件通知

审核通过后你会拿到这个域名的 DNS 管理权限，之后所有 DNS 记录都在
nic.eu.org 后台的域名管理面板里添加。

---

## 第二部分：EdgeOne Pages 绑定域名（主平台）

1. 进入 EdgeOne Pages 项目 → **域名管理** → 添加自定义域名
2. 填 `main.yourlover.eu.org`（前缀随意，这里用 main 区分是主平台）
3. **关键**：节点/加速区域选择 **"全球（不含中国大陆）"**，而不是"中国大陆"或"全球"。
   只有明确排除大陆节点，才可能免于强制备案要求（国内节点法规上必须备案，无法绕开）
4. 系统会给一条需要配置的 DNS 记录（通常是 CNAME），先记下来，等第三部分统一去
   EU.org 后台配置

### 配置环境变量（AI 分析功能）

1. EdgeOne Pages 项目 → **设置** → **环境变量**
2. 新增：`DASHSCOPE_API_KEY` = 你的阿里云百炼 API Key
3. 重新触发一次部署，环境变量才会生效

---

## 第三部分：Cloudflare Pages 部署（备份平台）

1. 打开 https://dash.cloudflare.com/sign-up 注册（不需要中国身份实名）
2. 左侧 **Workers & Pages** → **创建应用程序** → **Pages** → **连接到 Git**
3. 授权 GitHub，选择同一个仓库
4. 构建设置：框架预设选 **None**，构建命令和输出目录都留空
   （Cloudflare 会自动识别 `functions/` 目录下的函数文件）
5. 部署完成后会拿到一个默认的 `xxx.pages.dev` 域名
6. 项目里的 **自定义域** → 添加 `backup.yourlover.eu.org`
7. Cloudflare 会给一条 CNAME 记录，同样先记下来

### 配置环境变量

1. Cloudflare Pages 项目 → **Settings** → **Environment variables**
2. 新增：`DASHSCOPE_API_KEY` = 同一个阿里云百炼 API Key
3. 保存后需要重新部署一次才生效（这是与 EdgeOne 完全独立的配置，
   两个平台不共享环境变量，需要各自设置一遍）

---

## 第四部分：统一去 EU.org 配置 DNS 记录

1. 登录 https://nic.eu.org/，进入你域名的管理面板
2. 添加两条 DNS 记录：
   ```
   类型: CNAME
   主机记录: main
   记录值: （EdgeOne 第二部分给你的那个地址）

   类型: CNAME
   主机记录: backup
   记录值: （Cloudflare 第三部分给你的那个 xxx.pages.dev）
   ```
3. 保存，等待生效（一般几分钟到几小时）

之后：
- **日常访问用** `https://main.yourlover.eu.org`（EdgeOne，国内速度更好）
- **EdgeOne 出问题时切换到** `https://backup.yourlover.eu.org`（Cloudflare，作为应急备份）

---

## 关于访问速度的现实预期

- **EdgeOne（main）**：因为选择了"不含中国大陆"的节点类型（未备案），
  实际速度会比"备案+国内节点"慢一些，但通常仍优于纯海外服务商
- **Cloudflare（backup）**：Cloudflare 的 Anycast 网络在中国大陆没有正式落地节点，
  国内访问会被调度到香港/东京/新加坡等周边节点，速度和稳定性会明显打折扣，
  晚高峰期间尤其可能出现波动。这是网络层面的客观限制，不是配置问题，
  免费版无法完全解决——所以它更适合作为"主站打不开时的应急备份"，
  而不是日常主力入口

## 关于费用

阿里云百炼新用户有一次性 7000万 Tokens 免费额度，`qwen-plus` 模型单独占用
其中 100万，这个项目的调用量在免费额度内可以用很久。EU.org 域名、EdgeOne
和 Cloudflare 的这部分功能都是免费的。

## 如果 AI 解读一直显示"请求失败"

1. **确认在哪个域名下测试** —— EdgeOne 和 Cloudflare 的环境变量是分开配置的，
   如果只配了一边，另一边自然会报"未配置 API Key"
2. **配置后没有重新部署** —— 两个平台都是一样，改环境变量后必须触发一次新部署
3. **确认变量名精确匹配** —— 都必须是 `DASHSCOPE_API_KEY`，大小写、拼写要完全一致
4. **确认函数文件路径正确** —— EdgeOne 是 `node-functions/analyze.js`，
   Cloudflare 是 `functions/analyze.js`，放错目录对应平台不会识别

---
Powered by Justin
