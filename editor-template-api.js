/**
 * editor.html 専用: テンプレート JSON のサーバー上書き（パスワードは API で検証）
 * 同一オリジンで server.js を起動したときのみ動作します。
 */
(function () {
  "use strict";

  function apiUrl(path) {
    var base = typeof window.__NOCODE_API_BASE__ === "string" ? window.__NOCODE_API_BASE__.replace(/\/$/, "") : "";
    return base + path;
  }

  function resolveTemplateKeyForDiskSave(doc) {
    var sel = document.getElementById("templateSelect");
    var fromSelect = sel && sel.value;
    if (fromSelect) return fromSelect;
    var ak = doc && doc.activeTemplateKey;
    var map = window.NoCodeTemplates && window.NoCodeTemplates.TEMPLATE_JSON_MAP;
    if (ak && map && map[ak]) return ak;
    return "";
  }

  function syncTemplateSelectFromDocument(doc) {
    var sel = document.getElementById("templateSelect");
    if (!sel || !doc) return;
    var ak = doc.activeTemplateKey;
    var map = window.NoCodeTemplates && window.NoCodeTemplates.TEMPLATE_JSON_MAP;
    if (!ak || !map || !map[ak]) return;
    try {
      sel.dataset.nocodeSuppressChange = "1";
      sel.value = ak;
      sel.dataset.nocodeSuppressChange = "";
    } catch (e) {
      try {
        sel.dataset.nocodeSuppressChange = "";
      } catch (e2) {}
    }
  }

  function safeCanvasSlice(vp) {
    var defaultCanvas = {
      widthPx: 1200,
      floorHeightPx: 480,
      backgroundColor: "#fffbf6",
      backgroundImageSrc: "",
      backgroundImageFit: "cover",
    };
    var c = defaultCanvas;
    try {
      if (vp && vp.canvas && typeof vp.canvas === "object" && !Array.isArray(vp.canvas)) {
        c = JSON.parse(JSON.stringify(vp.canvas));
      }
    } catch (e) {
      c = defaultCanvas;
    }
    var blocks = [];
    try {
      if (vp && Array.isArray(vp.blocks)) {
        blocks = JSON.parse(JSON.stringify(vp.blocks));
      } else if (vp && Array.isArray(vp.data)) {
        blocks = JSON.parse(JSON.stringify(vp.data));
      }
    } catch (e2) {
      blocks = [];
    }
    if (!Array.isArray(blocks)) {
      blocks = [];
    }
    return { canvas: c, data: blocks };
  }

  function buildDiskTemplatePayload() {
    if (!window.NoCodeBlockDocument || typeof window.NoCodeBlockDocument.serialize !== "function") {
      return { error: "エディタが未初期化です。数秒待ってから再度お試しください。" };
    }
    var doc = window.NoCodeBlockDocument.serialize();
    if (!doc || !doc.viewports) {
      return { error: "キャンバスデータを取得できません。" };
    }
    var desk = doc.viewports.desktop || {};
    var resp = doc.viewports.responsive || {};
    var key = resolveTemplateKeyForDiskSave(doc);
    if (!key) {
      return {
        error:
          "上書き先のテンプレートが決まっていません。一覧から選ぶか、先に「美容サロン」などテンプレートを読み込んでからお試しください。",
      };
    }
    var selPost = document.getElementById("templateSelect");
    if (selPost && key) {
      try {
        selPost.dataset.nocodeSuppressChange = "1";
        selPost.value = key;
        selPost.dataset.nocodeSuppressChange = "";
      } catch (e) {
        try {
          selPost.dataset.nocodeSuppressChange = "";
        } catch (e2) {}
      }
    }
    var opt =
      selPost && selPost.options && selPost.selectedIndex >= 0
        ? selPost.options[selPost.selectedIndex]
        : null;
    var mapLab = window.NoCodeTemplates && window.NoCodeTemplates.TEMPLATE_LABEL_MAP;
    var label = (mapLab && mapLab[key]) || (opt && opt.textContent) || key;
    var name = String(label).trim() || key || "テンプレート";
    var dSlice = safeCanvasSlice(desk);
    var mSlice = safeCanvasSlice(resp);
    return {
      templateKey: key,
      templateDesktop: {
        name: name,
        canvas: dSlice.canvas,
        data: Array.isArray(dSlice.data) ? dSlice.data : [],
      },
      templateMobile: {
        name: name,
        canvas: mSlice.canvas,
        data: Array.isArray(mSlice.data) ? mSlice.data : [],
      },
    };
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
    var pw = document.getElementById("nocode-template-save-password");
    var msg = document.getElementById("nocode-template-save-msg");
    if (pw) pw.value = "";
    if (msg) msg.textContent = "";
  }

  function setMsg(text, isError) {
    var msg = document.getElementById("nocode-template-save-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.color = isError ? "#b91c1c" : "";
  }

  async function postJson(url, body) {
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { res: res, data: data };
  }

  async function runSaveFlow(password) {
    setMsg("認証中…", false);
    var auth;
    try {
      auth = await postJson(apiUrl("/api/auth"), { password: password });
    } catch (e) {
      setMsg(
        "サーバーに接続できません。プロジェクト直下で npm start を実行し、http://localhost:（PORT）/editor.html から開いてください。",
        true
      );
      return;
    }
    if (auth.data && auth.data.error === "admin_password_unset") {
      setMsg(
        (auth.data.message || "ADMIN_PASSWORD 未設定") +
          " server.js 起動時のターミナルにも警告が出ます。",
        true
      );
      return;
    }
    if (!auth.res.ok || !auth.data || !auth.data.ok) {
      setMsg("パスワードが正しくないか、サーバーが拒否しました。", true);
      return;
    }
    var built = buildDiskTemplatePayload();
    if (built.error) {
      setMsg(built.error, true);
      return;
    }
    setMsg("保存中…", false);
    var save;
    try {
      save = await postJson(apiUrl("/api/save-template"), {
        password: password,
        templateKey: built.templateKey,
        templateDesktop: built.templateDesktop,
        templateMobile: built.templateMobile,
      });
    } catch (e) {
      setMsg("保存リクエストに失敗しました（ネットワークまたはサーバー未起動）。", true);
      return;
    }
    if (save.data && save.data.error === "admin_password_unset") {
      setMsg(save.data.message || "ADMIN_PASSWORD が未設定です。", true);
      return;
    }
    if (!save.res.ok || !save.data || !save.data.ok) {
      var err = save.data && save.data.error ? save.data.error : "save_failed";
      var detail = save.data && save.data.detail ? " (" + save.data.detail + ")" : "";
      if (err === "invalid_template_body") {
        setMsg("保存データの形式がサーバーで拒否されました" + detail + "。PC/スマホ両方のキャンバスを確認してください。", true);
      } else if (err === "invalid_path") {
        setMsg(
          "保存先パスの検証に失敗しました。server.js を最新の状態にし、プロジェクト直下で npm start を再起動してから再度お試しください（Windows のパス判定を修正済みです）。",
          true
        );
      } else if (err === "write_failed") {
        setMsg(
          "ファイルの書き込みに失敗しました。templates フォルダの書き込み権限・OneDrive の同期・ウイルス対策のロックを確認してください。",
          true
        );
      } else {
        setMsg("保存に失敗しました（" + err + detail + "）。", true);
      }
      return;
    }
    if (window.NoCodeTemplates && typeof window.NoCodeTemplates.invalidateTemplateCache === "function") {
      window.NoCodeTemplates.invalidateTemplateCache(built.templateKey);
    }
    setMsg("保存しました。再読込すると最新のテンプレートが使われます。", false);
    setTimeout(function () {
      closeModal(document.getElementById("nocode-template-save-modal"));
    }, 1600);
  }

  var _initAttempts = 0;

  function init() {
    var btn = document.getElementById("template-save-overwrite");
    var modal = document.getElementById("nocode-template-save-modal");
    var backdrop = modal && modal.querySelector(".nocode-admin-modal__backdrop");
    var cancel = document.getElementById("nocode-template-save-cancel");
    var confirmBtn = document.getElementById("nocode-template-save-confirm");
    var pw = document.getElementById("nocode-template-save-password");

    if (!btn || !modal) return;
    if (!window.NoCodeBlockDocument || typeof window.NoCodeBlockDocument.serialize !== "function") {
      _initAttempts += 1;
      if (_initAttempts < 120) {
        setTimeout(init, 50);
      }
      return;
    }

    btn.addEventListener("click", function () {
      try {
        if (window.NoCodeBlockDocument && typeof window.NoCodeBlockDocument.serialize === "function") {
          syncTemplateSelectFromDocument(window.NoCodeBlockDocument.serialize());
        }
      } catch (e) {}
      openModal(modal);
      if (pw) {
        pw.focus();
      }
      setMsg("", false);
    });

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        closeModal(modal);
      });
    }
    if (cancel) {
      cancel.addEventListener("click", function () {
        closeModal(modal);
      });
    }
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        var password = pw ? pw.value : "";
        if (!password) {
          setMsg("パスワードを入力してください。", true);
          return;
        }
        runSaveFlow(password);
      });
    }
    if (pw) {
      pw.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (confirmBtn) confirmBtn.click();
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
