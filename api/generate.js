"use strict";

const { postGenerateExpress } = require("../lib/ai-generate");

module.exports = async function handler(req, res) {
  try {
    await postGenerateExpress(req, res);
  } catch (err) {
    console.error("[api/generate]", err);
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.status(500).json({
        error: err && err.message ? String(err.message) : "内部エラーが発生しました。",
        code: "internal_error",
      });
    }
  }
};
