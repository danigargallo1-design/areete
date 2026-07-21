// Archivo — listado de informes archivados y consulta en solo lectura.

import { seedDefaults, historyList, getRitual } from "./ritual.js";
import { formatDate } from "./utils.js";
import { el, clear } from "./ui.js";
import { db } from "./storage.js";

const root = () => document.getElementById("app");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}

let items = [];
let selected = null;
let detail = null;
let detailRaw = null;

const pad4 = (n) => String(n).padStart(4, "0");

function hhmm(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

async function boot() {
  await seedDefaults();
  const profile = await db.get("profile", "default");
  document.documentElement.dataset.font = profile?.font ?? "inter";
  items = await historyList();
  render();
}

async function open(date) {
  detail = await getRitual(date);
  detailRaw = await db.findOne("days", (d) => d.date === date);
  selected = date;
  render();
}

function render() {
  clear();
  const header = el("header", {}, [
    el("a", { href: "./index.html", text: "← VOLVER" }),
    el("h1", { text: "ARCHIVO" }),
  ]);
  let body;
  if (!selected) {
    if (items.length === 0) {
      body = el("p", { class: "empty", text: "SIN INFORMES ARCHIVADOS" });
    } else {
      body = el("div", { class: "history-list" });
      // Numeración inversa: el informe más antiguo es 0001; el más reciente el mayor.
      const total = items.length;
      items.forEach((item, idx) => {
        const number = pad4(total - idx);
        body.appendChild(
          el("button", { onClick: () => open(item.date) }, [
            el("span", { text: `INFORME ${number}` }),
            el("small", { text: formatDate(item.date) }),
          ])
        );
      });
    }
  } else {
    body = el("div", { class: "history-detail" }, [
      el("button", { class: "back", onClick: () => { selected = null; detail = null; render(); }, text: "← ARCHIVO" }),
      el("p", { class: "date", text: formatDate(selected) }),
      detailRaw?.completedAt
        ? el("p", { class: "date", style: "margin-top:-24px;margin-bottom:44px;", text: `EMITIDO · ${hhmm(detailRaw.completedAt)}` })
        : null,
    ]);
    for (const cat of detail?.categories ?? []) {
      const section = el("div", { class: "read-section" }, [el("h2", { text: cat.title })]);
      for (const habit of cat.habits) {
        section.appendChild(el("p", {}, [
          el("span", { text: habit.label }),
          el("span", { text: habit.checked ? "SÍ" : "—" }),
        ]));
      }
      body.appendChild(section);
    }
    const longFields = [
      ["PRIMERA HORA", detail?.firstHour],
      ["CONDUCTA CORRECTA", detail?.good],
      ["CONDUCTA INCORRECTA", detail?.bad],
      ["DISPOSICIÓN", detail?.tomorrow],
    ];
    for (const [title, text] of longFields) {
      if (text) {
        body.appendChild(el("div", { class: "read-section" }, [
          el("h2", { text: title }),
          el("p", { class: "long-text", text }),
        ]));
      }
    }
  }
  const section = el("section", { class: "page" }, [header, body]);
  root().appendChild(section);
}

boot();
