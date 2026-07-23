/**
 * Cloudflare Pages Function
 * 文件路径: /functions/logout.js
 * 访问路径: POST https://你的域名/logout
 *
 * 作用：清除服务器端的会话记录，并让浏览器的 Cookie 立即过期。
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

export const onRequestPost = async ({ request, env }) => {
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');

  if (sessionToken && env.DB) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(sessionToken).run();
  }

  const expiredCookie = 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': expiredCookie,
    },
  });
};
