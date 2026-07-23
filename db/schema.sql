-- Cloudflare D1 数据库结构
-- 部署方法见 README-登录功能部署说明.md 里的"第一步"

-- 用户表：以邮箱为唯一身份，没有密码字段（魔法链接登录不存密码）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

-- 登录令牌表：用户申请登录邮件时生成，一次性使用，15分钟过期
CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- 会话表：用户点击邮件里的链接验证成功后创建，对应浏览器里的登录态 Cookie，30天过期
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 测评记录表：每完成一次测评（在登录状态下）保存一条
-- data_json 里完整保存了 {scores, answers} 两部分，足够在历史记录里
-- 无损复原当时的完整报告和原始作答记录页面，不需要额外拆表存题目明细
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  headline TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id, created_at DESC);
