/**
 * OpenAI 文章生成: 利用制限・クールダウン・バリデーション
 * Express / Vercel の両方から利用する。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const COOLDOWN_MS = 5000;
const DAILY_CAP = 5;
const MAX_PROMPT_CHARS = 500;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw == null || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function usageFilePath() {
  return path.join(__dirname, "..", "data", "generate-usage.json");
}

function loadUsageFromDisk() {
  const p = usageFilePath();
  try {
    const buf = fs.readFileSync(p, "utf8");
    const j = JSON.parse(buf);
    if (j && typeof j === "object" && j.users && typeof j.users === "object") {
      return j;
    }
  } catch (e) {
    /* empty */
  }
  return { users: {} };
}

function saveUsageToDisk(store) {
  const p = usageFilePath();
  const dir = path.dirname(p);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error("[ai-generate] saveUsageToDisk", e);
  }
}

/** Vercel 等サーバレスではファイルが使えない／共有されないためメモリのみ */
const memoryStore = { users: {} };

function isVercel() {
  return process.env.VERCEL === "1";
}

function getUsageStore() {
  if (isVercel()) {
    return memoryStore;
  }
  return loadUsageFromDisk();
}

function persistUsageStore(store) {
  if (isVercel()) {
    return;
  }
  saveUsageToDisk(store);
}

function jsonError(res, status, code, message) {
  if (!res.headersSent) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  return res.status(status).json({ error: message, code: code });
}

function setUsageHeaders(res, usedCount, remainingCount) {
  res.setHeader("X-Usage-Limit", String(DAILY_CAP));
  res.setHeader("X-Usage-Used", String(Math.max(0, usedCount)));
  res.setHeader("X-Usage-Remaining", String(Math.max(0, remainingCount)));
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed = parseAllowedOrigins();
  if (origin && allowed.indexOf(origin) !== -1) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

function handleCorsPreflight(req, res) {
  const origin = req.headers.origin;
  const allowed = parseAllowedOrigins();
  if (allowed.length === 0) {
    return jsonError(res, 503, "cors_unconfigured", "ALLOWED_ORIGINS が未設定です。.env にフロントの URL をカンマ区切りで設定してください。");
  }
  if (!origin || allowed.indexOf(origin) === -1) {
    return jsonError(res, 403, "cors_denied", "このオリジンからのアクセスは許可されていません。");
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  return res.status(204).end();
}

/** @returns {boolean} 続行可能なら true */
function assertCorsOrReject(req, res) {
  const origin = req.headers.origin;
  const allowed = parseAllowedOrigins();
  if (allowed.length === 0) {
    jsonError(res, 503, "cors_unconfigured", "ALLOWED_ORIGINS が未設定です。.env にフロントの URL をカンマ区切りで設定してください。");
    return false;
  }
  if (!origin) {
    jsonError(res, 403, "origin_required", "Origin ヘッダーが必要です（ブラウザ以外では Origin を付与してください）。");
    return false;
  }
  if (allowed.indexOf(origin) === -1) {
    jsonError(res, 403, "cors_denied", "このオリジンからのアクセスは許可されていません。");
    return false;
  }
  setCorsHeaders(req, res);
  return true;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function postGenerateExpress(req, res) {
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req, res);
  }
  if (req.method !== "POST") {
    if (!assertCorsOrReject(req, res)) return;
    return jsonError(res, 405, "method_not_allowed", "POST のみ対応しています。");
  }

  if (!assertCorsOrReject(req, res)) return;

  let body = req.body;
  if (!body || typeof body !== "object") {
    return jsonError(res, 400, "invalid_body", "JSON ボディが必要です。");
  }

  const userId = body.userId != null ? String(body.userId).trim() : "";
  if (!userId) {
    return jsonError(res, 400, "user_id_required", "userId が必要です。");
  }

  const prompt = body.prompt != null ? String(body.prompt) : "";
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonError(res, 400, "prompt_too_long", "プロンプトは最大 " + MAX_PROMPT_CHARS + " 文字までです。");
  }
  if (!prompt.trim()) {
    return jsonError(res, 400, "prompt_empty", "プロンプトを入力してください。");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return jsonError(res, 503, "openai_unconfigured", "OPENAI_API_KEY が設定されていません。");
  }

  const store = getUsageStore();
  if (!store.users) store.users = {};

  const now = Date.now();
  const today = todayStr();
  let rec = store.users[userId];
  if (!rec || typeof rec !== "object") {
    rec = { date: today, count: 0 };
  }
  if (rec.date !== today) {
    rec = { date: today, count: 0 };
  }

  const lastAt = typeof rec.lastRequestAt === "number" ? rec.lastRequestAt : 0;
  if (now - lastAt < COOLDOWN_MS) {
    setUsageHeaders(res, rec.count, DAILY_CAP - rec.count);
    return jsonError(res, 429, "cooldown", "同じユーザーからの連続リクエストは " + COOLDOWN_MS / 1000 + " 秒空けてください。");
  }

  if (rec.count >= DAILY_CAP) {
    setUsageHeaders(res, rec.count, 0);
    return jsonError(res, 429, "daily_limit", "1 日あたりの利用上限（" + DAILY_CAP + " 回）に達しました。");
  }

  let OpenAI;
  try {
    OpenAI = require("openai").OpenAI;
  } catch (e) {
    return jsonError(res, 500, "dependency_missing", "openai パッケージを読み込めません。npm install を実行してください。");
  }

  const model = (process.env.OPENAI_MODEL && String(process.env.OPENAI_MODEL).trim()) || "gpt-4.1-mini";
  const client = new OpenAI({ apiKey: apiKey.trim() });

  let text;
  try {
    const completion = await client.chat.completions.create({
      model: model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    });
    const raw = completion.choices && completion.choices[0] && completion.choices[0].message;
    text = raw && raw.content != null ? String(raw.content) : "";
  } catch (e) {
    console.error("[ai-generate] OpenAI", e && e.message ? e.message : e);
    const msg = e && e.message ? String(e.message) : "OpenAI の呼び出しに失敗しました。";
    return jsonError(res, 502, "openai_error", msg);
  }

  rec.count = (typeof rec.count === "number" ? rec.count : 0) + 1;
  rec.lastRequestAt = now;
  rec.date = today;
  store.users[userId] = rec;
  persistUsageStore(store);

  setUsageHeaders(res, rec.count, DAILY_CAP - rec.count);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.status(200).send(text);
}

/**
 * Vercel Serverless（req.body は既にパース済みのことが多い）
 */
module.exports = {
  postGenerateExpress,
  COOLDOWN_MS,
  DAILY_CAP,
  MAX_PROMPT_CHARS,
  parseAllowedOrigins,
};
