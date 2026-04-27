(function () {
  "use strict";

  var tbody = document.getElementById("admin-tbody");
  var table = document.getElementById("admin-table");
  var emptyEl = document.getElementById("admin-empty");
  var btnNew = document.getElementById("admin-new-page");
  var btnMigrate = document.getElementById("admin-migrate");

  function fmtDate(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return (
      d.getFullYear() +
      "/" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(d.getDate()).padStart(2, "0") +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function render() {
    if (!window.NoCodePages) return;
    var pages = window.NoCodePages.listPages();
    tbody.textContent = "";
    if (pages.length === 0) {
      table.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    table.hidden = false;
    pages.forEach(function (p) {
      var tr = document.createElement("tr");
      var id = p.id;

      var tdTitle = document.createElement("td");
      var titleInp = document.createElement("input");
      titleInp.type = "text";
      titleInp.className = "admin-page-title-input";
      titleInp.value = p.title || "無題";
      titleInp.setAttribute("aria-label", "ページタイトル（自由に編集可）");
      titleInp.setAttribute("spellcheck", "false");
      titleInp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          titleInp.blur();
        }
      });
      titleInp.addEventListener("blur", function () {
        var v = titleInp.value.trim();
        if (!v) v = "無題のLP";
        var cur = window.NoCodePages.getPage(id);
        var prev = (cur && cur.title) || "無題";
        if (v === prev) {
          titleInp.value = prev;
          return;
        }
        if (window.NoCodePages.updatePageTitle(id, v)) {
          titleInp.value = v;
          var tdDate = tr.querySelector(".admin-date");
          if (tdDate) tdDate.textContent = fmtDate(Date.now());
        } else {
          titleInp.value = prev;
        }
      });
      tdTitle.appendChild(titleInp);

      var tdDate = document.createElement("td");
      tdDate.className = "admin-date";
      tdDate.textContent = fmtDate(p.updatedAt);

      var tdAct = document.createElement("td");
      tdAct.className = "admin-row-actions";

      var aEdit = document.createElement("a");
      aEdit.href = "index.html?page=" + encodeURIComponent(id);
      aEdit.className = "btn btn-primary";
      aEdit.textContent = "編集";

      var aView = document.createElement("a");
      aView.href = "lp.html?id=" + encodeURIComponent(id);
      aView.className = "btn";
      aView.target = "_blank";
      aView.rel = "noopener noreferrer";
      aView.textContent = "公開ページ";

      var btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn btn-danger";
      btnDel.textContent = "削除";
      btnDel.addEventListener("click", function () {
        if (!window.confirm("「" + (p.title || "無題") + "」を削除しますか？")) return;
        if (window.NoCodePages.deletePage(id)) render();
      });

      tdAct.appendChild(aEdit);
      tdAct.appendChild(aView);
      tdAct.appendChild(btnDel);
      tr.appendChild(tdTitle);
      tr.appendChild(tdDate);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
  }

  if (btnNew) {
    btnNew.addEventListener("click", function () {
      if (!window.NoCodePages || typeof window.NoCodePages.createPage !== "function") return;
      var title = window.prompt("ページのタイトル（後からエディタで保存すると一覧に反映されます）", "新しいLP");
      if (title === null) return;
      var pg = window.NoCodePages.createPage(title);
      if (pg && pg.id) {
        window.location.href = "index.html?page=" + encodeURIComponent(pg.id);
      }
    });
  }

  if (btnMigrate) {
    btnMigrate.addEventListener("click", function () {
      if (!window.NoCodePages || typeof window.NoCodePages.migrateLegacyIfNeeded !== "function") return;
      if (window.NoCodePages.migrateLegacyIfNeeded()) {
        alert("以前の「ブラウザ単一保存」を 1 件のページとして取り込みました。");
        render();
      } else {
        alert("取り込める旧データがないか、すでに取り込み済みです。");
      }
    });
  }

  window.NoCodePages.migrateLegacyIfNeeded();
  render();
})();
