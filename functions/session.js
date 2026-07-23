/**
 * Cloudflare Pages Function
 * 文件路径: /functions/session.js
 * 访问路径: GET https://你的域名/session
 *
 * 作用：前端页面加载时调用，检查浏览器 Cookie 里的 session 是否有效，
 * 返回当前登录用户的邮箱（未登录则返回 loggedIn: false）。
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

export const onRequestGet = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };

  if (!env.DB) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers });
  }

  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers });
  }

  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.email as email, users.id as user_id
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();

  if (!row || Date.now() > row.expires_at) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers });
  }

  return new Response(JSON.stringify({ loggedIn: true, email: row.email }), { headers });
};
