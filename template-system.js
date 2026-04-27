/**
 * NoCodeTool — テンプレート周辺の補助（バニラJS）
 *
 * 【配置】 block-document-schema.js → app.js → 本ファイル
 * テンプレート本体・loadTemplate / initTemplateUI は app.js 内の NoCodeTemplates を参照。
 */

(function () {
  "use strict";

  function exportCanvasJsonToConsole() {
    if (!window.NoCodeBlockDocument || typeof window.NoCodeBlockDocument.serialize !== "function") {
      console.error("[NoCodeTemplate] serialize がありません。");
      return;
    }
    const doc = window.NoCodeBlockDocument.serialize();
    console.log("[NoCode export] 現在のキャンバス JSON:\n", JSON.stringify(doc, null, 2));
    return doc;
  }

  /** 旧コード互換: app.js のテンプレート読み込みに委譲 */
  function loadTemplate(templateName) {
    if (window.NoCodeTemplates && typeof window.NoCodeTemplates.loadTemplate === "function") {
      return window.NoCodeTemplates.loadTemplate(templateName);
    }
    console.warn("[NoCodeTemplate] NoCodeTemplates.loadTemplate が利用できません。");
    return false;
  }

  window.NoCodeTemplate = {
    loadTemplate: loadTemplate,
    exportCanvasJsonToConsole: exportCanvasJsonToConsole,
  };

  var btnExportConsole = document.getElementById("template-export-console");
  if (btnExportConsole) {
    btnExportConsole.addEventListener("click", function () {
      exportCanvasJsonToConsole();
    });
  }
})();
