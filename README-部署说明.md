# 部署说明：接入 DeepSeek AI 深度解读

这个项目现在有两部分：

```
/index.html          前端页面（测评问卷 + 报告展示）
/api/analyze.js       Vercel Serverless Function（安全调用 DeepSeek API）
```

## 为什么要多一个 `api/analyze.js`？

DeepSeek（以及几乎所有 LLM API）都**不允许浏览器直接调用**——一是会暴露你的 API Key
给所有打开这个网页的人，二是官方接口本身没有开放跨域（CORS），浏览器会直接拦截请求。

所以正确的做法是：前端把数据发给你自己的一个小接口（`/api/analyze`），这个接口在服务器端
持有 Key，替你去调用 DeepSeek，再把结果传回来。Vercel 原生支持这种"接口文件"，
`api/` 文件夹下的 `.js` 文件会被自动识别成一个个 Serverless Function，不需要你自己搭服务器。

## 部署步骤

### 1. 把这两个文件推到你连接 Vercel 的 GitHub 仓库

确保仓库根目录结构是：
```
你的仓库/
  ├── index.html
  └── api/
      └── analyze.js
```

### 2. 在 Vercel 后台配置环境变量（最关键的一步）

1. 打开你的 Vercel 项目 → **Settings** → **Environment Variables**
2. 新增一条：
   - **Key**: `DEEPSEEK_API_KEY`
   - **Value**: 你的 DeepSeek API Key（从 https://platform.deepseek.com/api_keys 获取）
   - **Environment**: 建议三个环境（Production / Preview / Development）都勾选
3. 保存后，**重新触发一次部署**（Deployments 页面右上角 "Redeploy"），环境变量才会生效

### 3. 完成

推送代码后 Vercel 会自动构建。测评做完后，结果页会多一个「AI 深度解读」标签页，
自动请求 `/api/analyze`，几秒到几十秒后展示 DeepSeek 生成的专业分析。

## 关于费用

- DeepSeek 目前提供一定的免费额度，具体额度和最新价格以 https://platform.deepseek.com 为准
- 这个功能每次"测完一次问卷"大概会调用一次 API，输入约 4000-7000 字（原始作答记录），
  输出约 800-1200 字的分析报告，单次成本很低
- 如果不想被刷调用（比如有人反复点"重新生成"），可以后续加一个简单的频率限制，
  跟我说一声我可以帮你加上

## 如果 AI 解读一直显示"请求失败"

大概率是这几种情况之一：
1. **环境变量没配对** —— 检查 Vercel 后台的 Key 名称必须精确是 `DEEPSEEK_API_KEY`
2. **配置后没有重新部署** —— 环境变量的更新不会自动应用到已经部署的版本，需要手动 Redeploy
3. **DeepSeek Key 本身无效或额度用完** —— 去 platform.deepseek.com 后台确认
4. **模型名过期** —— 当前用的是 `deepseek-v4-flash`；如果 DeepSeek 未来更换了模型名，
   需要同步修改 `api/analyze.js` 里的 `model` 字段

---
Powered by Justin
