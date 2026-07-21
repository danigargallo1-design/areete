// Rendering helpers shared by every page. Kept intentionally small — plain
// DOM APIs, no framework — so the visual result matches the original React
// version exactly.

import { escapeHtml } from "./utils.js";
import { replaceScreen } from "./transitions.js";

const root = () => document.getElementById("app");

export function clear() {
  const app = root();
  while (app.firstChild) app.removeChild(app.firstChild);
}

// Loading atraviesa el motor de transiciones para que nunca coincida con
// otra pantalla montada. Devuelve la promesa por si se necesita esperar.
export function mountLoading(text) {
  return replaceScreen(() => {
    const div = document.createElement("div");
    div.className = "loading";
    div.textContent = text;
    return div;
  });
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// Frame de pantalla — reemplaza cualquier pantalla anterior siguiendo el
// contrato de `replaceScreen`: fade-out completo → DOM limpio → fade-in.
export function mountScreen(builder, { action, label, disabled } = {}) {
  return replaceScreen(() => {
    const section = el("section", { class: "screen" }, [
      el("div", { class: "screen-content" }, [builder()]),
      action
        ? el("button", {
            class: "bottom-action",
            onClick: () => action(),
            disabled: disabled || false,
          }, label || "PROSEGUIR")
        : null,
    ]);
    return section;
  });
}

// Textarea with a 600ms debounced commit — matches components/TextArea.tsx.
export function textArea({ value, placeholder, onCommit }) {
  const ta = document.createElement("textarea");
  ta.value = value ?? "";
  ta.placeholder = placeholder ?? "";
  ta.setAttribute("aria-label", placeholder ?? "");
  let timer;
  ta.addEventListener("input", () => {
    clearTimeout(timer);
    const draft = ta.value;
    timer = setTimeout(() => {
      if (draft !== value) onCommit(draft);
    }, 600);
  });
  return ta;
}

// Time field that commits on blur, matches TimeField() inside RitualApp.tsx.
export function timeField({ label, value, commit }) {
  const input = el("input", {
    inputmode: "numeric",
    maxlength: 4,
    placeholder: "2235",
    value: value ?? "",
    onInput: (e) => (e.target.value = e.target.value.replace(/\D/g, "")),
    onBlur: (e) => commit(e.target.value),
  });
  return el("label", { class: "time-field" }, [el("span", { text: label }), input]);
}

// Choice row list — one button per habit, checkbox on the right.
export function choiceList(category, onToggle) {
  const list = el("div", { class: "choice-list" });
  for (const habit of category.habits) {
    const row = el(
      "button",
      { class: "choice-row", onClick: () => onToggle(habit.id, !habit.checked) },
      [
        el("span", { text: habit.label }),
        el("span", { "aria-hidden": "true", class: "check" + (habit.checked ? " checked" : "") }),
      ]
    );
    list.appendChild(row);
  }
  return list;
}

export { escapeHtml };
