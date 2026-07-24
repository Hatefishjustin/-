/**
 * Cloudflare Pages Function
 * 文件路径: /functions/auth/verify.js
 * 访问路径: GET https://你的域名/auth/verify?token=xxx
 *
 * 作用：用户点击登录邮件里的链接后，验证令牌有效性，
 * 找到或创建对应用户，生成会话（Session），写入 Cookie，
 * 然后跳转回首页，此时前端会检测到已登录状态。
 *
 * 如果这个令牌在申请时带了待认领的测评结果（pending_result_json），
 * 验证成功后会自动把这份结果存进新登录的账号名下——不管这次验证是在
 * 哪个浏览器/设备完成的，都不影响这份数据被正确保存。如果保存成功，
 * 跳转链接会带上 recordId 参数，前端会自动打开显示这份报告。
 */

const SESSION_DAYS = 30;
const MAX_RECORDS_PER_USER = 200;

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
    'SELECT token, email, expires_at, used, pending_result_json FROM login_tokens WHERE token = ?'
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

  await env.DB.prepare('UPDATE login_tokens SET used = 1 WHERE token = ?').bind(token).run();

  let user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(row.email).first();
  if (!user) {
    const insertResult = await env.DB.prepare(
      'INSERT INTO users (email, created_at) VALUES (?, ?)'
    ).bind(row.email, Date.now()).run();
    user = { id: insertResult.meta.last_row_id, email: row.email };
  }

  const sessionToken = crypto.randomUUID();
  const sessionExpires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionToken, user.id, sessionExpires).run();

  const cookie = `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`;

  let claimedRecordId = null;
  if (row.pending_result_json) {
    try {
      const pending = JSON.parse(row.pending_result_json);
      const headline = typeof pending?.headline === 'string' ? pending.headline.slice(0, 100) : '我的测评结果';
      const dataJson = JSON.stringify(pending?.data || {});

      if (dataJson.length <= 100000) {
        const countRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM records WHERE user_id = ?').bind(user.id).first();
        if (countRow && countRow.cnt >= MAX_RECORDS_PER_USER) {
          await env.DB.prepare(
            'DELETE FROM records WHERE id = (SELECT id FROM records WHERE user_id = ? ORDER BY created_at ASC LIMIT 1)'
          ).bind(user.id).run();
        }
        const insertRecord = await env.DB.prepare(
          'INSERT INTO records (user_id, created_at, headline, data_json) VALUES (?, ?, ?, ?)'
        ).bind(user.id, Date.now(), headline, dataJson).run();
        claimedRecordId = insertRecord.meta.last_row_id;
      }
    } catch (err) {
      // 待认领数据解析或写入失败，不影响登录本身，静默跳过
    }
  }

  const redirectUrl = claimedRecordId
    ? `${origin}/?login=success&recordId=${claimedRecordId}`
    : `${origin}/?login=success`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      'Set-Cookie': cookie,
    },
  });
};
