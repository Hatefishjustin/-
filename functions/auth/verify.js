/**
 * Cloudflare Pages Function
 * 文件路径: /functions/auth/verify.js
 * 访问路径: GET https://你的域名/auth/verify?token=xxx
 *
 * 作用：用户点击登录邮件里的链接后，验证令牌有效性，
 * 找到或创建对应用户，生成会话（Session），写入 Cookie，
 * 然后跳转回首页，此时前端会检测到已登录状态。
 */

const SESSION_DAYS = 30;

function redirectWithMessage(origin, status, msg) {
  const url = `${origin}/?login=${status}${msg ? '&msg=' + encodeURIComponent(msg) : ''}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

export const onRequestGet = async ({ request, env }) => {
  const origin = new URL(request.url).origin;

  if (!env.DB) {
    return redirectWithMessage(origin, 'error', '服务器未绑定数据库');
  }

  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return redirectWithMessage(origin, 'error', '缺少登录令牌');
  }

  const row = await env.DB.prepare(
    'SELECT token, email, expires_at, used FROM login_tokens WHERE token = ?'
  ).bind(token).first();

  if (!row) {
    return redirectWithMessage(origin, 'error', '登录链接无效');
  }
  if (row.used) {
    return redirectWithMessage(origin, 'error', '这个登录链接已经使用过了');
  }
  if (Date.now() > row.expires_at) {
    return redirectWithMessage(origin, 'error', '登录链接已过期，请重新申请');
  }

  // 标记该令牌已使用，防止重复使用（即使被截获也无法二次登录）
  await env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE token = ?').bind(token).run();

  // 查找或创建用户
  let user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(row.email).first();
  if (!user) {
    const insertResult = await env.DB.prepare(
      'INSERT INTO users (email, created_at) VALUES (?, ?)'
    ).bind(row.email, Date.now()).run();
    user = { id: insertResult.meta.last_row_id, email: row.email };
  }

  // 创建会话
  const sessionToken = crypto.randomUUID();
  const sessionExpires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionToken, user.id, sessionExpires).run();

  const cookie = `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/?login=success`,
      'Set-Cookie': cookie,
    },
  });
};
