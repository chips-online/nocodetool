"use strict";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(405).json({ error: "GET のみ対応しています。", code: "method_not_allowed" });
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
};
