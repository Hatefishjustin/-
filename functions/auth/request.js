/**
 * Cloudflare Pages Function
 * 文件路径: /functions/auth/request.js
 * 访问路径: POST https://你的域名/auth/request
 *
 * 作用：用户输入邮箱后，生成一个一次性登录令牌，存入 D1，
 * 并通过 Resend 发一封带登录链接的邮件。用户点击链接即完成登录
 * （魔法链接 / Magic Link 模式，不需要用户设置或记住密码）。
 *
 * 如果请求里带了 pendingResult（用户测完之后才决定登录，手头正好有一份
 * 刚测完还没保存的结果），会把这份结果连同令牌一起存起来。等验证成功的
 * 那一刻——不管是在哪个浏览器/设备完成的——都会自动把这份结果存进新登录
 * 的账号名下，彻底跟"具体是哪个标签页登录成功"解耦，解决魔法链接经常在
 * 邮箱App内置浏览器里被消耗掉、导致原本测试的浏览器登不进去、测评结果
 * 丢失需要重测的问题。
 *
 * 依赖的环境配置（都在 Cloudflare Pages 后台设置）：
 * - D1 数据库绑定，变量名必须是 DB
 * - 环境变量 RESEND_API_KEY：Resend 的 API Key
 * - 环境变量 MAIL_FROM：发件地址，格式如 "心镜 <login@你的域名>"
 *   （必须是已在 Resend 验证过的域名，否则 Resend 只允许发给你自己的邮箱，
 *   对其他用户会发送失败）
 * - db/migration_pending_result.sql 必须已经在 D1 控制台执行过
 *   （login_tokens.pending_result_json 字段来自这次迁移）
 */

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

const lastRequestByIp = new Map();
const THROTTLE_WINDOW_MS = 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PENDING_RESULT_CHARS = 100000;

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost = async ({ request, env }) => {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const last = lastRequestByIp.get(ip);
  if (last && now - last < THROTTLE_WINDOW_MS) {
    return jsonResponse({ error: 'rate_limited', message: '请求太频繁，请等待一分钟后再试。' }, 429);
  }
  lastRequestByIp.set(ip, now);

  if (!env.DB) {
    return jsonResponse({ error: 'missing_db', message: '服务器未绑定 D1 数据库，请在 Cloudflare Pages 设置中绑定名为 DB 的数据库。' }, 500);
  }
  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: 'missing_resend_key', message: '服务器未配置 RESEND_API_KEY 环境变量。' }, 500);
  }
  if (!env.MAIL_FROM) {
    return jsonResponse({ error: 'missing_mail_from', message: '服务器未配置 MAIL_FROM 环境变量（发件地址）。' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体不是合法 JSON' }, 400);
  }

  const email = (body?.email || '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email) || email.length > 200) {
    return jsonResponse({ error: 'invalid_email', message: '邮箱格式不正确' }, 400);
  }

  let pendingResultJson = null;
  if (body?.pendingResult && typeof body.pendingResult === 'object') {
    try {
      const serialized = JSON.stringify(body.pendingResult);
      if (serialized.length <= MAX_PENDING_RESULT_CHARS) {
        pendingResultJson = serialized;
      }
    } catch (e) {
      // 序列化失败也静默丢弃，不影响正常登录
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = now + 15 * 60 * 1000;

  try {
    await env.DB.prepare(
      'INSERT INTO login_tokens (token, email, expires_at, used, pending_result_json) VALUES (?, ?, ?, 0, ?)'
    ).bind(token, email, expiresAt, pendingResultJson).run();
  } catch (err) {
    return jsonResponse({ error: 'db_error', message: '写入数据库失败：' + String(err?.message || err) }, 500);
  }

  const origin = new URL(request.url).origin;
  const verifyUrl = `${origin}/auth/verify?token=${token}`;
  const hasPendingResult = !!pendingResultJson;

  const emailHtml = `
    <div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1C2333;">
      <h2 style="font-size:20px;margin-bottom:16px;">心镜 · 登录确认</h2>
      <p style="font-size:14px;line-height:1.8;color:#444;">点击下方按钮即可完成登录，链接 15 分钟内有效，且只能使用一次。</p>
      ${hasPendingResult ? `<p style="font-size:13px;line-height:1.7;color:#888;background:#f7f2f4;padding:10px 14px;border-radius:6px;">你刚才做的测评结果已经安全保存，登录后会自动出现在你的账号里，不用担心丢失或需要重新测。</p>` : ''}
      <p style="margin:28px 0;">
        <a href="${verifyUrl}" style="background:#C4526E;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:15px;display:inline-block;">立即登录</a>
      </p>
      <p style="font-size:12.5px;color:#999;line-height:1.7;">如果按钮无法点击，请复制以下链接到浏览器打开：<br>${verifyUrl}</p>
      <p style="font-size:12px;color:#bbb;margin-top:24px;">如果这不是你本人的操作，请忽略这封邮件。</p>
    </div>
  `;

  try {
    const mailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [email],
        subject: '心镜 · 你的登录链接',
        html: emailHtml,
      }),
    });

    if (!mailResp.ok) {
      const errBody = await mailResp.text().catch(() => '');
      return jsonResponse({
        error: 'mail_send_failed',
        message: '登录邮件发送失败，请稍后重试。若持续失败，可能是发件域名尚未在 Resend 验证。',
        detail: errBody.slice(0, 500),
      }, 502);
    }
  } catch (err) {
    return jsonResponse({ error: 'mail_network_error', message: '连接邮件服务失败，请稍后重试。' }, 504);
  }

  return jsonResponse({
    ok: true,
    message: hasPendingResult
      ? '登录链接已发送，请查收邮箱（包括垃圾邮件箱）。你刚才的测评结果已经保存，登录后会自动出现。'
      : '登录链接已发送，请查收邮箱（包括垃圾邮件箱）。',
  });
};
