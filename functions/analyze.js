/**
 * Cloudflare Pages Function
 * 文件路径: /functions/analyze.js
 * 访问路径: https://你的Cloudflare域名/analyze
 *
 * 这是 EdgeOne 版本（/node-functions/analyze.js）的镜像备份，逻辑完全一致，
 * 只是改成了 Cloudflare Pages Functions 的写法规范：
 * - 用 onRequestPost({ request, env }) 而不是 EdgeOne 的 onRequestPost({ request })
 * - 环境变量通过 env.DASHSCOPE_API_KEY 读取，而不是 process.env.DASHSCOPE_API_KEY
 *   （Cloudflare Workers/Pages 运行时没有 Node.js 的 process 对象，
 *   所有绑定的环境变量都挂在 context.env 上）
 *
 * 部署后需要在 Cloudflare Pages 项目的 Settings → Environment variables 里
 * 单独配置一次 DASHSCOPE_API_KEY —— 这是与 EdgeOne 分开的独立配置，
 * 两个平台互不共享环境变量，需要各自设置一遍（用同一个阿里云百炼 Key 即可）。
 */

const lastRequestByIp = new Map();
const THROTTLE_WINDOW_MS = 20 * 1000; // 同一 IP 20 秒内最多 1 次请求

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost = async ({ request, env }) => {
  // 基础节流：防止短时间连续点击把免费额度刷完
  // Cloudflare 会自动在请求头里带上真实客户端 IP（CF-Connecting-IP）
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const last = lastRequestByIp.get(ip);
  if (last && now - last < THROTTLE_WINDOW_MS) {
    return jsonResponse({ error: 'rate_limited', message: '请求太频繁了，请等待几秒后再试一次。' }, 429);
  }
  lastRequestByIp.set(ip, now);

  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return jsonResponse({
      error: 'missing_api_key',
      message: '服务器未配置阿里云百炼 API Key，请在 Cloudflare Pages 项目设置的环境变量中添加 DASHSCOPE_API_KEY。',
    }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体不是合法 JSON' }, 400);
  }

  const { rawText } = body || {};
  if (!rawText || typeof rawText !== 'string') {
    return jsonResponse({ error: 'invalid_body', message: '缺少有效的 rawText 字段' }, 400);
  }
  if (rawText.length > 20000) {
    return jsonResponse({ error: 'payload_too_large', message: '提交的数据过长' }, 413);
  }

  const systemPrompt = `你是一位从业15年以上的资深亲密关系心理咨询师，同时具备扎实的学术背景——精通依恋理论（Bowlby & Ainsworth 的成人依恋研究）、大五人格模型（Costa & McCrae 的 OCEAN 框架）、Gary Chapman 的五种爱之语理论、以及关系价值观与长期承诺研究（如 Sternberg 的爱情三角理论）。

你将收到一位来访者完成的"理想伴侣心理测评"的完整原始作答记录，包括：每道题目的原文、来访者的具体选择、以及系统给出的初步量化计分。你的任务是像一次真实的深度咨询解读一样，写一份专业分析。

# 分析时必须做到

1. **拒绝空泛总结**：不要写"你渴望安全感""你重视沟通"这类任何人套上都成立的废话。每一个论断都必须能让人看出你确实读过TA的具体选择——引用或呼应1-2个具体题目的选择模式作为证据。
2. **抓住选择之间的张力与矛盾**：真实的人格从不是几个标签的简单拼贴。留意来访者身上可能存在的内部矛盾——比如依恋风格与爱语的错位（"你需要高频确认，却选择了回避型会本能疏远你的靠近方式"）、价值观排序中两项可能互斥的优先级（"你既要绝对的独立空间，又要共同财务规划，这两者需要更细的边界协商，而不是靠感觉"）。这种矛盾点的洞察，才是"专业"和"敷衍"的分界线。
3. **具体到"人"而非"类型"**：避免写成"依恋理论认为……"这种教科书口吻。直接对来访者说话，用"你"，像是坐在诊室里对话。
4. **给出诊断性但不评判的观察**：可以直接指出风险，比如"这种组合的人最容易在关系稳定后半年左右，因为激情消退而误判为'不合适'，其实那只是依恋系统从警觉进入常态"——这种基于机制的解释比泛泛的建议有说服力得多。
5. **具体、反直觉、可操作的建议优先于笼统建议**：不说"多沟通"，说具体沟通脚本或具体情境下的行为建议。

# 输出结构（严格用这个JSON结构返回，不要有任何多余文字、不要markdown代码块标记）

{
  "headline": "一句话总结来访者的核心关系模式，15-25字，要具体不要空泛，像一句精准的诊断而非鸡汤",
  "sections": [
    {
      "title": "小节标题（4-8字，如：依恋深读/人格互补逻辑/爱语背后的需求/价值观里的隐藏张力/关系风险预警/给你的具体建议）",
      "body": "该小节正文，200-260字，必须包含至少一次对具体题目选择的呼应作为论据支撑",
      "icon": "从这些里选一个最贴切的: heart, brain, puzzle, compass, shield, spark"
    }
  ],
  "closing": "结尾祝福或鼓励，30-50字，真诚不空洞，可以呼应前面提到的具体特质"
}

sections 数组应包含 4-5 个小节，覆盖：依恋模式深读、人格与沟通逻辑、爱语背后真正的心理需求、价值观内部的潜在张力、以及一条最重要的关系风险提示或建议。`;

  try {
    const upstream = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawText },
        ],
        stream: false,
        temperature: 0.85,
        max_tokens: 2600,
        response_format: { type: 'json_object' },
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '');
      let message = '阿里云百炼接口调用失败';
      if (upstream.status === 401) message = 'API Key 无效或已过期，请检查环境变量 DASHSCOPE_API_KEY';
      else if (upstream.status === 429) message = '请求过于频繁或免费额度已用尽，请稍后再试';
      else if (upstream.status >= 500) message = '阿里云百炼服务暂时不可用，请稍后再试';

      return jsonResponse({
        error: 'upstream_error',
        message,
        detail: errBody.slice(0, 500),
      }, upstream.status === 401 ? 500 : upstream.status);
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return jsonResponse({ error: 'empty_response', message: 'AI 未返回有效内容，请重试' }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const cleaned = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch (e2) {
        return jsonResponse({ analysisRaw: content });
      }
    }

    return jsonResponse({ analysis: parsed });
  } catch (err) {
    return jsonResponse({
      error: 'network_error',
      message: '连接阿里云百炼服务超时或失败，请稍后重试',
      detail: String((err && err.message) || err),
    }, 504);
  }
};
