/**
 * Cloudflare Pages Function
 * 文件路径: /functions/records.js
 * 访问路径:
 *   GET  /records          → 列出当前登录用户的所有历史记录（不含完整数据，只有摘要）
 *   GET  /records?id=123   → 获取某一条记录的完整数据（用于恢复报告页面）
 *   POST /records          → 保存一条新的测评记录（需要登录）
 *
 * 权限：所有操作都要求请求带有效的 session Cookie，否则返回 401。
 * 记录归属通过 user_id 严格校验，用户之间的数据互相隔离。
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const MAX_RECORDS_PER_USER = 200; // 防止单个账号无限堆积占满免费额度

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  const id = new URL(request.url).searchParams.get('id');

  if (id) {
    const row = await env.DB.prepare(
      'SELECT id, created_at, headline, data_json FROM records WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    if (!row) return jsonResponse({ error: 'not_found', message: '记录不存在或无权访问' }, 404);
    return jsonResponse({
      id: row.id,
      createdAt: row.created_at,
      headline: row.headline,
      data: JSON.parse(row.data_json),
    });
  }

  const { results } = await env.DB.prepare(
    'SELECT id, created_at, headline FROM records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(user.id, MAX_RECORDS_PER_USER).all();

  return jsonResponse({ records: results.map(r => ({ id: r.id, createdAt: r.created_at, headline: r.headline })) });
};

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体不是合法 JSON' }, 400);
  }

  const { headline, data } = body || {};
  if (!headline || typeof headline !== 'string' || !data) {
    return jsonResponse({ error: 'invalid_body', message: '缺少 headline 或 data 字段' }, 400);
  }

  const dataJson = JSON.stringify(data);
  if (dataJson.length > 100000) {
    return jsonResponse({ error: 'payload_too_large', message: '数据过大' }, 413);
  }

  // 超过上限时，先删除该用户最旧的一条，再插入新的，保持总数不超限
  const countRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM records WHERE user_id = ?').bind(user.id).first();
  if (countRow && countRow.cnt >= MAX_RECORDS_PER_USER) {
    await env.DB.prepare(
      'DELETE FROM records WHERE id = (SELECT id FROM records WHERE user_id = ? ORDER BY created_at ASC LIMIT 1)'
    ).bind(user.id).run();
  }

  const result = await env.DB.prepare(
    'INSERT INTO records (user_id, created_at, headline, data_json) VALUES (?, ?, ?, ?)'
  ).bind(user.id, Date.now(), headline.slice(0, 100), dataJson).run();

  return jsonResponse({ ok: true, id: result.meta.last_row_id });
};
