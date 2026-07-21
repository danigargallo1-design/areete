// MI ESTÁNDAR — Pantalla principal.
// La sección superior es el estándar: cuatro categorías, filas simples,
// edición inline, sin popups, sin botón de guardar. Debajo se mantienen
// los ajustes existentes (horarios, notificaciones, archivo) sin romper
// funcionalidad previa.

import { seedDefaults } from "./ritual.js";
import { db } from "./storage.js";
import { el, clear } from "./ui.js";
import * as notifications from "./notifications.js";
import {
  getStandard,
  addCommitment,
  renameCommitment,
  removeCommitment,
  moveCommitment,
  MAX_LABEL,
  MIN_COMMITMENTS,
} from "./standard.js";

const root = () => document.getElementById("app");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}

// Estado local exclusivo de la interfaz — no persiste nada.
let standard = [];
let editingId = null;         // compromiso en modo edición
let confirmingId = null;      // compromiso pendiente de confirmar eliminación
let addingCategory = null;    // categoría cuyo campo "AÑADIR" está abierto
let addingBuffer = "";        // texto temporal del campo AÑADIR
let profile = null;
let notice = "";              // mensaje efímero (p. ej. reglas de mínimo)

async function loadStandard() {
  standard = await getStandard();
  profile = (await db.get("profile", "default")) || { id: "default", font: "inter", targetBedTime: "2230", targetWakeTime: "0530" };
  document.documentElement.dataset.font = profile.font ?? "inter";
}

async function saveProfile() {
  const p = (await db.get("profile", "default")) || { id: "default" };
  Object.assign(p, profile);
  await db.put("profile", p);
  document.documentElement.dataset.font = profile.font ?? "inter";
}

function flashNotice(text) {
  notice = text;
  render();
  clearTimeout(flashNotice._t);
  flashNotice._t = setTimeout(() => { notice = ""; render(); }, 2800);
}

async function refresh() {
  await loadStandard();
  render();
}

// -------------------------------------------------------------
// Acciones del estándar (todas persisten automáticamente).
// -------------------------------------------------------------
async function doRename(catKey, id, label) {
  try { await renameCommitment(catKey, id, label); }
  catch (e) { flashNotice(e.message); }
  editingId = null;
  await refresh();
}

async function doRemove(catKey, id) {
  try {
    await removeCommitment(catKey, id);
    confirmingId = null;
    await refresh();
  } catch (e) {
    confirmingId = null;
    flashNotice(e.message);
  }
}

async function doMove(catKey, id, delta) {
  await moveCommitment(catKey, id, delta);
  await refresh();
}

async function doAdd(catKey, label) {
  try {
    await addCommitment(catKey, label);
    addingBuffer = "";
    addingCategory = null;
    await refresh();
  } catch (e) {
    flashNotice(e.message);
  }
}

// -------------------------------------------------------------
// Render de una fila de compromiso.
// -------------------------------------------------------------
function renderRow(cat, item, index, total) {
  // Estado: confirmando eliminación.
  if (confirmingId === item.id) {
    return el("div", { class: "std-row std-row--confirm" }, [
      el("span", { class: "std-confirm-text", text: "¿Eliminar este compromiso?" }),
      el("div", { class: "std-confirm-actions" }, [
        el("button", {
          class: "std-btn std-btn--ghost",
          "data-testid": `cancel-delete-${item.id}`,
          onClick: () => { confirmingId = null; render(); },
          text: "Cancelar",
        }),
        el("button", {
          class: "std-btn std-btn--danger",
          "data-testid": `confirm-delete-${item.id}`,
          onClick: () => doRemove(cat.key, item.id),
          text: "Eliminar",
        }),
      ]),
    ]);
  }

  // Estado: edición inline.
  if (editingId === item.id) {
    const input = el("input", {
      class: "std-row-input",
      type: "text",
      maxlength: MAX_LABEL,
      value: item.label,
      autofocus: true,
      "data-testid": `edit-input-${item.id}`,
      onKeydown: (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { editingId = null; render(); }
      },
      onBlur: (e) => {
        const v = e.target.value.trim();
        if (!v || v === item.label) { editingId = null; render(); return; }
        doRename(cat.key, item.id, v);
      },
    });
    const row = el("div", { class: "std-row std-row--editing" }, [input]);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return row;
  }

  // Estado: fila normal.
  return el("div", { class: "std-row" }, [
    el("span", { class: "std-label", text: item.label }),
    el("div", { class: "std-actions" }, [
      el("button", {
        class: "std-icon",
        title: "Mover arriba",
        disabled: index === 0,
        "data-testid": `move-up-${item.id}`,
        onClick: () => doMove(cat.key, item.id, -1),
        text: "▲",
      }),
      el("button", {
        class: "std-icon",
        title: "Mover abajo",
        disabled: index === total - 1,
        "data-testid": `move-down-${item.id}`,
        onClick: () => doMove(cat.key, item.id, 1),
        text: "▼",
      }),
      el("button", {
        class: "std-icon",
        title: "Editar",
        "data-testid": `edit-${item.id}`,
        onClick: () => { editingId = item.id; confirmingId = null; render(); },
        text: "✎",
      }),
      el("button", {
        class: "std-icon std-icon--danger",
        title: "Eliminar",
        "data-testid": `delete-${item.id}`,
        onClick: () => { confirmingId = item.id; editingId = null; render(); },
        text: "×",
      }),
    ]),
  ]);
}

// -------------------------------------------------------------
// Render de una categoría (tarjeta).
// -------------------------------------------------------------
function renderCategory(cat) {
  const rows = cat.commitments.map((item, i) =>
    renderRow(cat, item, i, cat.commitments.length)
  );

  // Zona "AÑADIR" al final de la categoría.
  let addNode;
  if (addingCategory === cat.key) {
    const input = el("input", {
      class: "std-add-input",
      type: "text",
      maxlength: MAX_LABEL,
      placeholder: "Nuevo compromiso",
      value: addingBuffer,
      "data-testid": `add-input-${cat.key}`,
      onInput: (e) => { addingBuffer = e.target.value; },
      onKeydown: (e) => {
        if (e.key === "Enter") { e.preventDefault(); doAdd(cat.key, addingBuffer); }
        if (e.key === "Escape") { addingCategory = null; addingBuffer = ""; render(); }
      },
    });
    const btn = el("button", {
      class: "std-add-btn",
      "data-testid": `add-confirm-${cat.key}`,
      onClick: () => doAdd(cat.key, input.value),
      text: "AÑADIR",
    });
    addNode = el("div", { class: "std-add-open" }, [input, btn]);
    setTimeout(() => input.focus(), 0);
  } else {
    const atMax = cat.commitments.length >= 12;
    addNode = el("button", {
      class: "std-add-trigger",
      disabled: atMax,
      "data-testid": `add-trigger-${cat.key}`,
      onClick: () => {
        if (atMax) { flashNotice("Máximo 12 compromisos por categoría."); return; }
        addingCategory = cat.key;
        addingBuffer = "";
        editingId = null;
        confirmingId = null;
        render();
      },
      text: atMax ? "MÁXIMO ALCANZADO" : "+ Añadir compromiso",
    });
  }

  return el("section", { class: "std-card", "data-testid": `category-${cat.key}` }, [
    el("h2", { class: "std-card-title", text: cat.title }),
    el("div", { class: "std-rows" }, rows),
    addNode,
  ]);
}

// -------------------------------------------------------------
// Sección de horarios y tipografía (existente).
// -------------------------------------------------------------
function renderRhythmSection() {
  return el("section", { class: "std-config" }, [
    el("h2", { class: "std-config-title", text: "HORARIOS" }),
    el("label", { class: "std-config-field" }, [
      el("span", { text: "HORA OBJETIVO DE ACOSTARSE" }),
      el("input", {
        inputmode: "numeric", maxlength: 4, value: profile.targetBedTime ?? "",
        onInput: (e) => { profile.targetBedTime = e.target.value.replace(/\D/g, ""); },
        onBlur: () => saveProfile(),
      }),
    ]),
    el("label", { class: "std-config-field" }, [
      el("span", { text: "HORA OBJETIVO DE LEVANTARSE" }),
      el("input", {
        inputmode: "numeric", maxlength: 4, value: profile.targetWakeTime ?? "",
        onInput: (e) => { profile.targetWakeTime = e.target.value.replace(/\D/g, ""); },
        onBlur: () => saveProfile(),
      }),
    ]),
    (() => {
      const select = el("select", {
        onChange: (e) => { profile.font = e.target.value; saveProfile(); },
      });
      for (const [value, label] of [["inter", "Inter"], ["plex-sans", "IBM Plex Sans"], ["plex-serif", "IBM Plex Serif"]]) {
        const opt = el("option", { value, text: label });
        if ((profile.font ?? "inter") === value) opt.selected = true;
        select.appendChild(opt);
      }
      return el("label", { class: "std-config-field" }, [el("span", { text: "TIPOGRAFÍA" }), select]);
    })(),
  ]);
}

// -------------------------------------------------------------
// Sección de notificaciones (misma UX que antes).
// -------------------------------------------------------------
function renderNotificationsSection() {
  const state = { cfg: notifications.getConfig(), status: "" };
  const section = el("section", { class: "std-config notif-section" }, [
    el("h2", { class: "std-config-title", text: "RECORDATORIOS" }),
  ]);
  const build = () => {
    while (section.childNodes.length > 1) section.removeChild(section.lastChild);
    const supported = notifications.isSupported();
    const perm = notifications.permissionStatus();

    const toggleRow = el("div", { class: "notif-toggle-row" }, [
      el("span", { text: "RECORDATORIOS" }),
      el("button", {
        text: state.cfg.enabled ? "ACTIVOS" : "INACTIVOS",
        onClick: async () => {
          if (!supported) return;
          if (!state.cfg.enabled) {
            if (perm !== "granted") {
              const r = await notifications.requestPermission();
              if (r !== "granted") { build(); return; }
            }
            state.cfg = notifications.setConfig({ enabled: true });
          } else {
            state.cfg = notifications.setConfig({ enabled: false });
          }
          build();
        },
      }),
    ]);
    section.appendChild(toggleRow);

    if (!supported) {
      section.appendChild(el("p", { class: "notif-blocked", text: "Este navegador no soporta notificaciones locales." }));
      return;
    }
    if (perm === "denied") {
      section.appendChild(el("p", { class: "notif-blocked", text: "Los recordatorios están bloqueados a nivel de sistema." }));
    }

    section.appendChild(el("p", { class: "notif-freq-title", text: "FRECUENCIA" }));
    const freqList = el("div", { class: "notif-freq-list" });
    for (const opt of [
      { value: 1, label: "CADA HORA" },
      { value: 2, label: "CADA 2 HORAS" },
      { value: 3, label: "CADA 3 HORAS" },
      { value: 4, label: "CADA 4 HORAS" },
    ]) {
      const row = el("div", {
        class: "notif-freq-row",
        onClick: () => { state.cfg = { ...state.cfg, frequency: opt.value }; build(); },
      }, [
        el("span", { class: "notif-freq-radio" + (state.cfg.frequency === opt.value ? " checked" : "") }),
        el("span", { text: opt.label }),
      ]);
      freqList.appendChild(row);
    }
    section.appendChild(freqList);

    const timeGrid = el("div", { class: "notif-time-grid" }, [
      el("label", {}, [
        "HORA INICIAL",
        el("input", {
          inputmode: "numeric", maxlength: 4, value: state.cfg.startTime,
          onInput: (e) => { e.target.value = e.target.value.replace(/\D/g, ""); state.cfg = { ...state.cfg, startTime: e.target.value }; },
        }),
      ]),
      el("label", {}, [
        "HORA FINAL",
        el("input", {
          inputmode: "numeric", maxlength: 4, value: state.cfg.endTime,
          onInput: (e) => { e.target.value = e.target.value.replace(/\D/g, ""); state.cfg = { ...state.cfg, endTime: e.target.value }; },
        }),
      ]),
    ]);
    section.appendChild(timeGrid);

    section.appendChild(el("button", {
      class: "notif-save",
      text: "GUARDAR",
      onClick: async () => {
        const validHHMM = (v) => /^([01][0-9]|2[0-3])[0-5][0-9]$/.test(v);
        if (!validHHMM(state.cfg.startTime) || !validHHMM(state.cfg.endTime)) {
          state.status = "FORMATO INVÁLIDO (HHMM)"; build(); return;
        }
        const s = parseInt(state.cfg.startTime, 10);
        const e = parseInt(state.cfg.endTime, 10);
        if (e < s) { state.status = "RANGO HORARIO INCOHERENTE"; build(); return; }
        await notifications.applyConfig({
          enabled: state.cfg.enabled,
          frequency: state.cfg.frequency,
          startTime: state.cfg.startTime,
          endTime: state.cfg.endTime,
        });
        state.status = "REGISTRADO"; build();
        setTimeout(() => { state.status = ""; build(); }, 2500);
      },
    }));
    section.appendChild(el("p", { class: "notif-status", text: state.status }));
  };
  build();
  return section;
}

// -------------------------------------------------------------
// Sección de archivo (export / import / reset).
// -------------------------------------------------------------
async function exportData() {
  const [prof, categories, habits, days, entries, quotes] = await Promise.all([
    db.get("profile", "default"),
    db.all("categories"),
    db.all("habits"),
    db.all("days"),
    db.all("entries"),
    db.all("quotes"),
  ]);
  const backup = { version: 1, exportedAt: new Date().toISOString(), profile: prof, categories, habits, days, entries, quotes };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `arete-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup?.categories || !backup?.habits || !backup?.days || !backup?.entries) {
      window.alert("El archivo no parece una copia de ARETÉ."); return;
    }
    await db.clear("entries");
    await db.clear("days");
    await db.clear("habits");
    await db.clear("categories");
    if (backup.quotes) { await db.clear("quotes"); await db.bulkPut("quotes", backup.quotes); }
    await db.bulkPut("categories", backup.categories);
    await db.bulkPut("habits", backup.habits);
    await db.bulkPut("days", backup.days);
    await db.bulkPut("entries", backup.entries);
    if (backup.profile) await db.put("profile", { id: "default", ...backup.profile });
  } catch { window.alert("No se pudo importar el archivo."); }
}

async function resetRegistry() {
  await db.clear("entries");
  await db.clear("days");
}

function renderArchiveSection() {
  const fileInput = el("input", {
    type: "file", accept: "application/json", hidden: true,
    onChange: async (e) => {
      const f = e.target.files?.[0];
      if (f) { await importData(f); await refresh(); }
    },
  });
  return el("section", { class: "std-config" }, [
    el("h2", { class: "std-config-title", text: "ARCHIVO" }),
    el("button", { class: "std-config-btn", text: "EXPORTAR REGISTRO", onClick: () => exportData() }),
    el("button", { class: "std-config-btn", text: "IMPORTAR REGISTRO", onClick: () => fileInput.click() }),
    fileInput,
    el("button", {
      class: "std-config-btn std-config-btn--danger",
      text: "RESTABLECER REGISTRO",
      onClick: () => {
        if (window.confirm("SE ELIMINARÁN TODOS LOS INFORMES ARCHIVADOS. ¿CONTINUAR?")) resetRegistry().then(refresh);
      },
    }),
  ]);
}

// -------------------------------------------------------------
// Render principal.
// -------------------------------------------------------------
function render() {
  clear();
  if (!profile) {
    root().appendChild(el("div", { class: "loading", text: "ABRIENDO MI ESTÁNDAR" }));
    return;
  }

  const header = el("header", {}, [
    el("a", { href: "./index.html", "data-testid": "back-home", text: "← VOLVER" }),
    el("h1", { text: "MI ESTÁNDAR" }),
  ]);

  const intro = el("p", {
    class: "std-intro",
    text: "Los compromisos con los que decides medir tu carácter cada día.",
  });

  const cardsWrap = el("div", { class: "std-cards" });
  for (const cat of standard) cardsWrap.appendChild(renderCategory(cat));

  const noticeNode = el("p", { class: "std-notice" + (notice ? " std-notice--visible" : ""), text: notice });

  const content = el("div", { class: "settings-content std-content" }, [
    intro,
    cardsWrap,
    noticeNode,
    renderRhythmSection(),
    renderNotificationsSection(),
    renderArchiveSection(),
  ]);

  const section = el("section", { class: "page settings std-page" }, [header, content]);
  root().appendChild(section);
  void MIN_COMMITMENTS; // referenciado en mensajes de error
}

async function boot() {
  await seedDefaults();
  await loadStandard();
  render();
  notifications.init();
}

boot();
