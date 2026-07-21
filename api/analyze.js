/**
 * Vercel Serverless Function
 * 路径: /api/analyze
 *
 * 作用：接收前端传来的"理想伴侣测评"原始作答记录，转发给 DeepSeek API 做
 * 专业心理学角度的深度解读，再把结果返回给前端。
 *
 * 安全设计：
 * - DeepSeek API Key 只存在于 Vercel 的环境变量（process.env.DEEPSEEK_API_KEY），
 *   永远不会出现在发给浏览器的任何代码或响应里。
 * - 对请求体大小、字段类型做校验，避免被滥用当作免费文本转发代理。
 * - 对 DeepSeek 侧的常见错误（key无效/额度耗尽/超时）做区分，给前端明确的错误码，
 *   方便展示对用户有意义的提示而不是一个干巴巴的"出错了"。
 */

export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed', message: '仅支持 POST 请求' });
  }

  // 简单的 CORS：只需要同源前端调用即可，这里保留基础头部，
  // 如果你的前端和这个函数部署在同一个 Vercel 项目下（推荐做法），实际上不需要额外配置。
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    // Key 没在 Vercel 环境变量里配置好
    return res.status(500).json({
      error: 'missing_api_key',
      message: '服务器未配置 DeepSeek API Key，请在 Vercel 项目设置的环境变量中添加 DEEPSEEK_API_KEY。',
    });
  }

  const { rawText } = req.body || {};

  if (!rawText || typeof rawText !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: '缺少有效的 rawText 字段' });
  }

  // 防止被滥用成任意文本转发：限制长度（正常一份39题测评记录大约在4000-7000字符）
  if (rawText.length > 20000) {
    return res.status(413).json({ error: 'payload_too_large', message: '提交的数据过长' });
  }

  const systemPrompt = `你是一位资深的婚恋心理咨询师，精通依恋理论（Bowlby & Ainsworth）、大五人格模型（Big Five/OCEAN）、盖瑞·查普曼的五种爱之语理论，以及亲密关系价值观匹配研究。

你将收到一份用户完成的"理想伴侣心理测评"的完整原始作答记录（包含题目、用户的具体选择，以及系统的初步计分）。请你基于这些原始数据，给出一份专业、有深度、有温度的分析报告。

报告要求：
1. 不要简单复述系统已给出的初步结论，要结合具体题目里用户的选择模式，挖掘更细腻的心理动因和潜在的关系模式。
2. 指出用户可能存在的关系盲区或需要留意的风险点（例如依恋类型与爱语的错位、价值观内部的潜在张力等），但表达要温和、建设性，不评判、不贴负面标签。
3. 给出具体、可操作的建议，比如"什么样的伴侣特质最能与你互补"、"你在关系初期最需要注意的沟通方式"等。
4. 语言使用简体中文，专业但不生硬，像一位真正懂心理学、也真诚关心用户的咨询师在对话，而不是罗列心理学术语。
5. 全文控制在800-1200字左右，用清晰的分段呈现（可以用小标题），不要用互联网媒体式的浮夸标题。
6. 结尾用一两句话给予真诚而不空洞的祝福或鼓励。
7. 不要输出任何免责声明、道歉或"我不是专业人士"之类的话——你在这个场景中扮演专业角色即可；但也不要给出临床诊断式的断言。`;

  try {
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawText },
        ],
        thinking: { type: 'disabled' },
        stream: false,
        temperature: 1.0,
        max_tokens: 2000,
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '');
      let message = 'DeepSeek 接口调用失败';
      if (upstream.status === 401) message = 'API Key 无效或已过期，请检查 Vercel 环境变量中的 DEEPSEEK_API_KEY';
      else if (upstream.status === 429) message = 'DeepSeek 请求过于频繁或额度已用尽，请稍后再试';
      else if (upstream.status >= 500) message = 'DeepSeek 服务暂时不可用，请稍后再试';

      return res.status(upstream.status === 401 ? 500 : upstream.status).json({
        error: 'upstream_error',
        message,
        detail: errBody.slice(0, 500),
      });
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: 'empty_response', message: 'AI 未返回有效内容，请重试' });
    }

    return res.status(200).json({ analysis: content });
  } catch (err) {
    return res.status(504).json({
      error: 'network_error',
      message: '连接 DeepSeek 服务超时或失败，请稍后重试',
      detail: String(err && err.message || err),
    });
  }
}
