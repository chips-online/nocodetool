/**
 * NoCodeTool — 静的ファイル配信 + テンプレート上書き API
 * 起動: npm start  （要 .env に ADMIN_PASSWORD）
 */
"use strict";

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const aiGenerate = require("./lib/ai-generate");

const PORT = parseInt(process.env.PORT, 10) || 3847;
const ROOT = __dirname;

/** クライアントの templateKey と templates/ 内ファイル名（PC / スマホ別・パストラバーサル防止） */
const TEMPLATE_KEY_TO_FILES = {
  beautySalon: { desktop: "salon.desktop.json", mobile: "salon.mobile.json" },
  cafe: { desktop: "cafe.desktop.json", mobile: "cafe.mobile.json" },
  productSalesStory: { desktop: "supplement.desktop.json", mobile: "supplement.mobile.json" },
  corporate: { desktop: "corporate.desktop.json", mobile: "corporate.mobile.json" },
  portfolio: { desktop: "portfolio.desktop.json", mobile: "portfolio.mobile.json" },
};

function readAdminPasswordSecret() {
  const raw = process.env.ADMIN_PASSWORD;
  const s = raw != null && typeof raw === "string" ? raw.trim() : "";
  return s.replace(/^\uFEFF/, "");
}

function verifyAdminPassword(input) {
  const secret = readAdminPasswordSecret();
  if (!secret) {
    return false;
  }
  const h = function (s) {
    return crypto.createHash("sha256").update(String(s), "utf8").digest();
  };
  const a = h(String(input != null ? input : "").trim());
  const b = h(secret);
  try {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/**
 * テンプレート 1 本分をディスク用に正規化する。
 * クライアントや旧データで data が欠ける・null・blocks のみ、などの揺れを吸収する。
 */
function normalizeSingleTemplate(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) {
    return null;
  }
  const nameRaw = t.name != null ? String(t.name) : "";
  const name = nameRaw.trim() || "テンプレート";
  let canvas = t.canvas;
  if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) {
    canvas = {};
  }
  let data = t.data;
  if (!Array.isArray(data)) {
    data = Array.isArray(t.blocks) ? t.blocks : [];
  }
  return { name: name, canvas: canvas, data: data };
}

function isValidTemplatePayload(body) {
  if (!body || typeof body !== "object") return false;
  const td = normalizeSingleTemplate(body.templateDesktop);
  const tm = normalizeSingleTemplate(body.templateMobile);
  if (!td || !tm) return false;
  body.templateDesktop = td;
  body.templateMobile = tm;
  return true;
}

const app = express();
app.disable("x-powered-by");
/** ブラウザ既定の /favicon.ico 要求で 404 が出ないよう SVG に寄せる */
app.get("/favicon.ico", function (req, res) {
  res.redirect(302, "/favicon.svg");
});
app.use(express.json({ limit: "32mb" }));
app.use(function (err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(400).json({ error: "JSON の形式が正しくありません。", code: "invalid_json" });
  }
  next(err);
});

app.post("/api/auth", function (req, res) {
  const secret = readAdminPasswordSecret();
  if (!secret) {
    return res.status(503).json({
      ok: false,
      error: "admin_password_unset",
      message: "サーバーの .env に ADMIN_PASSWORD が設定されていません。",
    });
  }
  const password = req.body && req.body.password;
  if (verifyAdminPassword(password)) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "unauthorized" });
});

app.post("/api/save-template", async function (req, res) {
  const secret = readAdminPasswordSecret();
  if (!secret) {
    return res.status(503).json({
      ok: false,
      error: "admin_password_unset",
      message: "サーバーの .env に ADMIN_PASSWORD が設定されていません。",
    });
  }
  const password = req.body && req.body.password;
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const templateKey = req.body && req.body.templateKey;
  const filePair = templateKey && TEMPLATE_KEY_TO_FILES[templateKey];
  if (!filePair || !filePair.desktop || !filePair.mobile) {
    return res.status(400).json({ ok: false, error: "invalid_template_key" });
  }
  if (!isValidTemplatePayload(req.body)) {
    const why = [];
    if (!normalizeSingleTemplate(req.body && req.body.templateDesktop)) {
      why.push("templateDesktop_invalid");
    }
    if (!normalizeSingleTemplate(req.body && req.body.templateMobile)) {
      why.push("templateMobile_invalid");
    }
    return res.status(400).json({
      ok: false,
      error: "invalid_template_body",
      detail: why.length ? why.join(",") : "unknown",
    });
  }
  const relDesktop = path.join("templates", filePair.desktop);
  const relMobile = path.join("templates", filePair.mobile);
  const absDesktop = path.join(ROOT, relDesktop);
  const absMobile = path.join(ROOT, relMobile);
  const templatesRoot = path.resolve(path.join(ROOT, "templates"));
  /**
   * Windows ではドライブ文字の大文字／小文字が混ざると String#startsWith が偽になり、
   * 正規の templates/ パスでも invalid_path になることがある。
   */
  function isResolvedFileUnderTemplates(absFile) {
    const f = path.resolve(absFile);
    const rel = path.relative(templatesRoot, f);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  }
  if (!isResolvedFileUnderTemplates(absDesktop) || !isResolvedFileUnderTemplates(absMobile)) {
    return res.status(400).json({ ok: false, error: "invalid_path" });
  }
  const normD = path.normalize(absDesktop);
  const normM = path.normalize(absMobile);
  const jsonD = JSON.stringify(req.body.templateDesktop, null, 2) + "\n";
  const jsonM = JSON.stringify(req.body.templateMobile, null, 2) + "\n";
  try {
    await fs.writeFile(normD, jsonD, "utf8");
    await fs.writeFile(normM, jsonM, "utf8");
  } catch (err) {
    console.error("[save-template]", err);
    return res.status(500).json({ ok: false, error: "write_failed" });
  }
  return res.json({ ok: true, paths: [relDesktop, relMobile] });
});

app.get("/api/public-config", function (req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
});

app.all("/generate", async function (req, res) {
  try {
    await aiGenerate.postGenerateExpress(req, res);
  } catch (err) {
    console.error("[/generate]", err);
    if (res.headersSent) return;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(500).json({ error: "内部エラーが発生しました。", code: "internal_error" });
  }
});

app.get("/editor", function (req, res) {
  return res.sendFile(path.join(ROOT, "index.html"));
});

app.get("/view", function (req, res) {
  return res.sendFile(path.join(ROOT, "lp.html"));
});

app.use(
  express.static(ROOT, {
    index: ["index.html", "editor.html"],
    setHeaders: function (res, filePath) {
      if (filePath && typeof filePath === "string" && filePath.replace(/\\/g, "/").indexOf("/templates/") !== -1) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

app.use(function (req, res) {
  if (req.path.indexOf("/api/") === 0) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  return res.status(404).send("Not found");
});

app.listen(PORT, function () {
  console.log("NoCodeTool server http://localhost:" + PORT + "/editor.html");
  if (!readAdminPasswordSecret()) {
    console.warn("警告: ADMIN_PASSWORD が未設定です。.env を参照してください。");
  }
});
