/**
 * Cloudflare Pages Function
 * 文件路径: /functions/admin/stats.js
 * 访问路径: GET https://你的域名/admin/stats
 *
 * 作用：给 admin.html 提供后台数据看板需要的全部统计数据。
 * 只有 users 表里 is_admin = 1 的账号才能访问，其他人（包括普通登录用户）
 * 一律返回 403。
 *
 * 依赖：
 * - D1 数据库绑定 DB（跟其他 Functions 共用同一个数据库）
 * - db/migration_admin.sql 必须已经在 D1 控制台执行过
 *   （users.is_admin 字段来自这次迁移）
 * - db/migration_completions.sql 必须已经在 D1 控制台执行过
 *   （completions 表来自这次迁移，用于统计包含匿名访客在内的真实完成量；
 *   注意这里"完成测试"相关的所有数字都来自 completions 表，而不是 records 表——
 *   records 表只包含登录用户主动保存的记录，会严重低估真实使用量）
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

async function getCurrentAdmin(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email, users.is_admin as is_admin
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  if (!row.is_admin) return null;
  return { id: row.user_id, email: row.email };
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) {
    return jsonResponse({ error: 'missing_db', message: '服务器未绑定 D1 数据库' }, 500);
  }

  const admin = await getCurrentAdmin(request, env);
  if (!admin) {
    return jsonResponse({ error: 'forbidden', message: '无权限访问，需要管理员账号登录后访问' }, 403);
  }

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgoMs = now - 14 * 24 * 60 * 60 * 1000;

  try {
    const [
      totalUsersRow,
      totalCompletionsRow,
      todayUsersRow,
      todayCompletionsRow,
      last7dUsersRow,
      prev7dUsersRow,
      quizTypeBreakdown,
      recentUsers,
      recentCompletions,
      anonCompletionsRow,
    ] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM completions').first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?').bind(todayStartMs).first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM completions WHERE created_at >= ?').bind(todayStartMs).first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ?').bind(sevenDaysAgoMs).first(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at >= ? AND created_at < ?').bind(fourteenDaysAgoMs, sevenDaysAgoMs).first(),
      env.DB.prepare('SELECT quiz_type, COUNT(*) as cnt FROM completions GROUP BY quiz_type ORDER BY cnt DESC').all(),
      env.DB.prepare('SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 10').all(),
      env.DB.prepare(
        `SELECT completions.headline as headline, completions.created_at as created_at, completions.quiz_type as quiz_type, users.email as email
         FROM completions LEFT JOIN users ON completions.user_id = users.id
         ORDER BY completions.created_at DESC LIMIT 10`
      ).all(),
      env.DB.prepare('SELECT COUNT(*) as cnt FROM completions WHERE user_id IS NULL').first(),
    ]);

    const last7d = last7dUsersRow?.cnt || 0;
    const prev7d = prev7dUsersRow?.cnt || 0;
    let growthPct = null;
    if (prev7d > 0) {
      growthPct = Math.round(((last7d - prev7d) / prev7d) * 1000) / 10;
    }

    const totalCompletions = totalCompletionsRow?.cnt || 0;
    const anonCompletions = anonCompletionsRow?.cnt || 0;

    return jsonResponse({
      generatedAt: now,
      totals: {
        users: totalUsersRow?.cnt || 0,
        completions: totalCompletions,
        anonCompletions,
      },
      today: {
        newUsers: todayUsersRow?.cnt || 0,
        completedTests: todayCompletionsRow?.cnt || 0,
      },
      growth: {
        last7dNewUsers: last7d,
        prev7dNewUsers: prev7d,
        growthPct,
      },
      quizTypeBreakdown: (quizTypeBreakdown.results || []).map(r => ({ quizType: r.quiz_type, count: r.cnt })),
      recentUsers: (recentUsers.results || []).map(r => ({ email: r.email, createdAt: r.created_at })),
      recentRecords: (recentCompletions.results || []).map(r => ({
        email: r.email,
        headline: r.headline,
        quizType: r.quiz_type,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return jsonResponse({
      error: 'query_failed',
      message: '统计查询失败：' + String(err?.message || err) + '（可能是 db/migration_admin.sql 或 db/migration_completions.sql 还没执行）',
    }, 500);
  }
};
