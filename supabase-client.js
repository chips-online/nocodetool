"use strict";

(function (global) {
  var CONFIG_ENDPOINT = "/api/public-config";
  var clientPromise = null;

  function createError(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  async function loadConfig() {
    var res = await fetch(CONFIG_ENDPOINT, { method: "GET" });
    if (!res.ok) {
      throw createError("公開設定の取得に失敗しました。", "config_fetch_failed");
    }
    var cfg = await res.json();
    var url = cfg && cfg.supabaseUrl ? String(cfg.supabaseUrl).trim() : "";
    var anon = cfg && cfg.supabaseAnonKey ? String(cfg.supabaseAnonKey).trim() : "";
    if (!url || !anon) {
      throw createError("SUPABASE_URL / SUPABASE_ANON_KEY が未設定です。", "config_missing");
    }
    return { url: url, anon: anon };
  }

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async function () {
        if (!global.supabase || typeof global.supabase.createClient !== "function") {
          throw createError("Supabaseクライアントが読み込まれていません。", "supabase_sdk_missing");
        }
        var cfg = await loadConfig();
        return global.supabase.createClient(cfg.url, cfg.anon);
      })();
    }
    return clientPromise;
  }

  global.NoCodeSupabase = {
    getClient: getClient,
  };
})(typeof window !== "undefined" ? window : this);
