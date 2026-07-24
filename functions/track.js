/**
 * Cloudflare Pages Function
 * 文件路径: /functions/track.js
 * 访问路径: POST https://你的域名/track
 *
 * 作用：每次有人完成测评（不管有没有登录）都会调用一次，写入一条轻量的
 * "完成事件"记录，只包含测试类型和一句摘要标签，不含任何具体作答内容。
 * 这是后台数据看板统计"今日完成测试""热门测试"等指标的真实数据来源，
 * 覆盖登录用户 + 匿名访客的全部使用量。
 *
 * 如果请求携带了有效的登录 Cookie，会顺带记录 user_id（可选，非必须），
 * 方便以后做"登录用户 vs 匿名用户"的对比分析；没有登录也完全正常工作。
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 同一 IP 5 秒内最多上报一次，防止被恶意刷接口污染统计数据
// （窗口比登录邮件那个短很多，因为这只是个轻量计数器，正常使用不会触发）
const lastRequestByIp = new Map();
const THROTTLE_WINDOW_MS = 5 * 1000;

export const onRequestPost = async ({ request, env }) => {
  if (!env.DB) {
    return jsonResponse({ ok: false, error: 'missing_db' }, 500);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const last = lastRequestByIp.get(ip);
  if (last && now - last < THROTTLE_WINDOW_MS) {
    return jsonResponse({ ok: false, error: 'rate_limited' }, 429);
  }
  lastRequestByIp.set(ip, now);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400);
  }

  const quizType = String(body?.quizType || 'ideal_partner').slice(0, 50);
  const headline = String(body?.headline || '').slice(0, 100);

  // 尝试识别登录状态，纯粹是锦上添花，不影响匿名用户正常记录
  let userId = null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (sessionToken) {
    const row = await env.DB.prepare(
      `SELECT sessions.expires_at as expires_at, users.id as user_id
       FROM sessions JOIN users ON sessions.user_id = users.id
       WHERE sessions.token = ?`
    ).bind(sessionToken).first();
    if (row && now <= row.expires_at) {
      userId = row.user_id;
    }
  }

  try {
    await env.DB.prepare(
      'INSERT INTO completions (user_id, quiz_type, headline, created_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, quizType, headline, now).run();
  } catch (err) {
    return jsonResponse({ ok: false, error: 'db_error', message: String(err?.message || err) }, 500);
  }

  return jsonResponse({ ok: true });
};
