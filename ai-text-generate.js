/**
 * AI テキスト生成: userId（UUID）を localStorage に保持し /generate へ POST する。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "nocode_ai_user_id";
  var MAX_PROMPT_CHARS = 500;

  function getApiBase() {
    var meta = document.querySelector('meta[name="nocode-ai-api-base"]');
    if (meta && meta.getAttribute("content") != null) {
      var c = String(meta.getAttribute("content")).trim();
      return c.replace(/\/$/, "");
    }
    return "";
  }

  function getOrCreateUserId() {
    try {
      var existing = localStorage.getItem(STORAGE_KEY);
      if (existing && String(existing).trim()) {
        return String(existing).trim();
      }
    } catch (e) {}
    var id;
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      id = crypto.randomUUID();
    } else {
      id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (e2) {}
    return id;
  }

  function buildCombinedPrompt() {
    var ta = document.getElementById("ai-text-prompt");
    var lengthEl = document.getElementById("ai-text-length");
    var toneEl = document.getElementById("ai-text-tone");
    var userTopic = ta ? String(ta.value || "").trim() : "";
    if (!userTopic) {
      return "";
    }
    var len = lengthEl && lengthEl.value ? lengthEl.value : "medium";
    var tone = toneEl && toneEl.value ? toneEl.value : "neutral";
    var lenJa = { short: "短め", medium: "標準の長さ", long: "長め" }[len] || len;
    var toneJa = {
      neutral: "ニュートラル",
      formal: "フォーマル",
      casual: "カジュアル",
      promo: "宣伝・訴求",
    }[tone] || tone;
    return (
      "【出力の長さの目安】" +
      lenJa +
      "\n【トーン】" +
      toneJa +
      "\n【指示・トピック】\n" +
      userTopic
    );
  }

  function setBadge(text) {
    var badge = document.querySelector(".ai-text-badge");
    if (badge) {
      badge.textContent = text;
    }
  }

  function updateBadgeFromResponse(res) {
    if (!res || !res.headers) return;
    var remaining = res.headers.get("X-Usage-Remaining");
    var limit = res.headers.get("X-Usage-Limit");
    if (remaining == null || limit == null) return;
    var remNum = parseInt(remaining, 10);
    var limitNum = parseInt(limit, 10);
    if (!Number.isFinite(remNum) || !Number.isFinite(limitNum) || limitNum <= 0) return;
    setBadge("本日の残り " + Math.max(0, remNum) + "/" + limitNum + " 回");
  }

  function setStatus(msg) {
    var hint = document.querySelector(".ai-text-hint");
    if (hint && msg) {
      hint.textContent = msg;
    }
  }

  function onGenerate() {
    var btn = document.getElementById("ai-text-generate-btn");
    var targetSel = document.getElementById("ai-text-target");
    var combined = buildCombinedPrompt();
    if (combined.length > MAX_PROMPT_CHARS) {
      setStatus("送信する全文が " + MAX_PROMPT_CHARS + " 文字を超えています。指示を短くするか、長さ・トーンを調整してください。");
      return;
    }
    if (!combined) {
      setStatus("指示・トピックを入力してください。");
      return;
    }

    var base = getApiBase();
    var origin = window.location.origin.replace(/\/$/, "");
    var url = (base ? base : origin) + "/generate";

    var userId = getOrCreateUserId();
    if (btn) {
      btn.disabled = true;
      btn.dataset.prevLabel = btn.textContent;
      btn.textContent = "生成中…";
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId, prompt: combined }),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          return { res: res, text: text };
        });
      })
      .then(function (_ref) {
        var res = _ref.res;
        var text = _ref.text;
        updateBadgeFromResponse(res);
        if (!res.ok) {
          var errMsg = text;
          try {
            var j = JSON.parse(text);
            if (j && j.error) {
              errMsg = j.error;
            }
          } catch (e) {}
          setStatus("エラー: " + errMsg + "（HTTP " + res.status + "）");
          return;
        }
        var applyApi = window.NoCodeAIText && typeof window.NoCodeAIText.apply === "function";
        if (!applyApi) {
          setStatus("内部エラー: エディタとの連携が読み込まれていません。");
          return;
        }
        var mode = targetSel && targetSel.value === "selected-text" ? "selected-text" : "new-block";
        var result = window.NoCodeAIText.apply(text, mode);
        if (!result || !result.ok) {
          var code = result && result.error ? result.error : "apply_failed";
          var map = {
            no_text_block_selected: "テキストブロックを1つ選択してください（反映先が「選択中のテキストブロック」のとき）。",
            empty_text: "生成結果が空でした。",
          };
          setStatus(map[code] || "反映できませんでした: " + code);
          return;
        }
        setStatus("キャンバスに反映しました。");
      })
      .catch(function (e) {
        setStatus("通信エラー: " + (e && e.message ? e.message : String(e)));
      })
      .then(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.prevLabel || "テキストを生成";
        }
      });
  }

  function init() {
    var btn = document.getElementById("ai-text-generate-btn");
    getOrCreateUserId();
    setBadge("本日の残り 5/5 回");
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-disabled");
      btn.removeAttribute("title");
      btn.addEventListener("click", onGenerate);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
