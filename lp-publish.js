"use strict";

(function (global) {
  var saveBtn = document.getElementById("persist-save-server");
  var urlWrap = document.getElementById("persist-server-url-wrap");
  var urlInput = document.getElementById("persist-server-url");
  var copyBtn = document.getElementById("persist-copy-server-url");
  var statusEl = document.getElementById("persist-status");

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message || "";
  }

  function setButtonBusy(busy) {
    if (!saveBtn) return;
    if (busy) {
      saveBtn.disabled = true;
      saveBtn.dataset.prevLabel = saveBtn.textContent || "サーバーに保存";
      saveBtn.textContent = "保存中...";
      return;
    }
    saveBtn.disabled = false;
    saveBtn.textContent = saveBtn.dataset.prevLabel || "サーバーに保存";
  }

  function buildViewUrl(pageId) {
    return window.location.origin.replace(/\/$/, "") + "/view?id=" + encodeURIComponent(pageId);
  }

  async function copyUrl() {
    if (!urlInput || !urlInput.value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(urlInput.value);
      } else {
        urlInput.focus();
        urlInput.select();
        document.execCommand("copy");
      }
      setStatus("URLをコピーしました。");
    } catch (e) {
      setStatus("URLのコピーに失敗しました。手動でコピーしてください。");
    }
  }

  async function saveToServer() {
    if (!global.NoCodeSupabase || typeof global.NoCodeSupabase.getClient !== "function") {
      setStatus("Supabaseクライアントの初期化に失敗しました。");
      return;
    }
    if (!global.NoCodeBlockDocument || typeof global.NoCodeBlockDocument.serialize !== "function") {
      setStatus("現在のLPデータを取得できませんでした。");
      return;
    }

    setButtonBusy(true);
    setStatus("サーバーに保存しています...");
    try {
      var doc = global.NoCodeBlockDocument.serialize();
      var client = await global.NoCodeSupabase.getClient();
      var result = await client.from("pages").insert({ content: doc }).select("id").single();
      if (result.error) {
        throw result.error;
      }
      var pageId = result.data && result.data.id ? String(result.data.id) : "";
      if (!pageId) {
        throw new Error("保存は完了しましたがIDを取得できませんでした。");
      }
      var viewUrl = buildViewUrl(pageId);
      if (urlInput) urlInput.value = viewUrl;
      if (urlWrap) urlWrap.hidden = false;
      setStatus("サーバー保存が完了しました。共有URLを発行しました。");
    } catch (e) {
      var msg = e && e.message ? String(e.message) : "サーバー保存に失敗しました。";
      setStatus("保存エラー: " + msg);
    } finally {
      setButtonBusy(false);
    }
  }

  function init() {
    if (saveBtn) {
      saveBtn.addEventListener("click", saveToServer);
    }
    if (copyBtn) {
      copyBtn.addEventListener("click", copyUrl);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : this);
