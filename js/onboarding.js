// Onboarding flow — visual card-based commitment library.
// Runs once, before the ritual, when the user has no habits yet.

import { db } from "./storage.js";
import { uid } from "./utils.js";
import { el, clear } from "./ui.js";
import { replaceScreen } from "./transitions.js";

const LIBRARY_URL = "./data/library.json";

// Secciones — una pantalla por categoría, en el orden del informe.
const STEPS = [
  { key: "thought",   tag: "SECCIÓN I",   title: "EL PENSAMIENTO", hint: "SELECCIONA LOS COMPROMISOS DEL PENSAMIENTO." },
  { key: "body",      tag: "SECCIÓN II",  title: "EL CUERPO",      hint: "SELECCIONA LOS COMPROMISOS DEL CUERPO." },
  { key: "habits",    tag: "SECCIÓN III", title: "LOS HÁBITOS",    hint: "SELECCIONA LOS HÁBITOS A MANTENER." },
  { key: "character", tag: "SECCIÓN IV",  title: "EL CARÁCTER",    hint: "SELECCIONA LAS INCIDENCIAS A REGISTRAR." },
];

export async function needsOnboarding() {
  const profile = await db.get("profile", "default");
  if (profile?.onboarded) return false;
  const habits = await db.all("habits");
  return habits.length === 0;
}

async function loadLibrary() {
  try {
    return await fetch(LIBRARY_URL, { cache: "no-store" }).then((r) => r.json());
  } catch {
    return { thought: [], body: [], habits: [], character: [] };
  }
}

// Card grid renderer.
function renderStep({ step, library, selection, onCommit }) {
  const state = {
    query: "",
    // items = library items + custom user items added in this step.
    items: [...(library[step.key] || [])],
    selected: new Set(selection[step.key] || []),
  };

  // Toda la construcción se difiere a `replaceScreen`: la pantalla del paso
  // anterior debe haberse desmontado por completo antes de que aparezcan
  // el título, la búsqueda o las tarjetas.
  let grid = null;

  function renderGrid() {
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const q = state.query.trim().toLowerCase();
    const filtered = q ? state.items.filter((i) => i.toLowerCase().includes(q)) : state.items;
    for (const label of filtered) {
      const isSelected = state.selected.has(label);
      const card = el("button", {
        type: "button",
        class: "commitment-card" + (isSelected ? " selected" : ""),
        onClick: () => {
          if (state.selected.has(label)) state.selected.delete(label);
          else state.selected.add(label);
          renderGrid();
        },
        text: label,
      });
      grid.appendChild(card);
    }
    if (filtered.length === 0) {
      grid.appendChild(el("p", { class: "onboarding-empty", text: "Sin resultados." }));
    }
  }

  return replaceScreen(() => {
    const section = el("section", { class: "screen onboarding-screen" });

    const content = el("div", { class: "screen-content onboarding-content" });
    const wrap = el("div", { class: "onboarding-wrap" });

    const eyebrow = el("p", { class: "onboarding-eyebrow" });
    eyebrow.appendChild(el("span", { class: "section-tag", text: step.tag }));
    eyebrow.appendChild(document.createTextNode(step.title));
    wrap.appendChild(eyebrow);
    wrap.appendChild(el("p", { class: "onboarding-hint", text: step.hint }));

    const search = el("input", {
      class: "onboarding-search",
      type: "search",
      placeholder: "BUSCAR",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      onInput: (e) => { state.query = e.target.value; renderGrid(); },
    });
    wrap.appendChild(search);

    grid = el("div", { class: "commitment-grid" });
    wrap.appendChild(grid);

    // Custom commitment.
    const customLabel = el("p", { class: "onboarding-custom-label", text: "REGISTRAR COMPROMISO PROPIO" });
    const customInput = el("input", {
      class: "onboarding-custom-input",
      type: "text",
      placeholder: "Escribir compromiso",
      autocomplete: "off",
    });
    const customAdd = el("button", {
      class: "onboarding-custom-add",
      type: "button",
      text: "REGISTRAR",
      onClick: () => {
        const value = customInput.value.trim();
        if (!value) return;
        const exists = state.items.find((i) => i.toLowerCase() === value.toLowerCase());
        if (!exists) state.items.push(value);
        state.selected.add(exists || value);
        customInput.value = "";
        state.query = "";
        search.value = "";
        renderGrid();
      },
    });
    const customRow = el("div", { class: "onboarding-custom" }, [customLabel, customInput, customAdd]);
    wrap.appendChild(customRow);

    content.appendChild(wrap);
    section.appendChild(content);

    const action = el("button", {
      class: "bottom-action",
      onClick: () => onCommit(Array.from(state.selected), state.items),
      text: "CONFIRMAR",
    });
    section.appendChild(action);

    // Render inicial de la cuadrícula tras construir el DOM local.
    renderGrid();
    return section;
  });
}

export async function runOnboarding() {
  const library = await loadLibrary();
  const selection = { thought: [], body: [], habits: [], character: [] };

  await new Promise((resolve) => {
    let i = 0;
    const nextStep = () => {
      if (i >= STEPS.length) return resolve();
      const step = STEPS[i];
      renderStep({
        step,
        library,
        selection,
        onCommit: (selected) => {
          selection[step.key] = selected;
          i++;
          nextStep();
        },
      });
    };
    nextStep();
  });

  // Persist: for every category, write habits in the order the user selected them.
  const categories = (await db.all("categories")).sort((a, b) => a.position - b.position);
  for (const cat of categories) {
    const labels = selection[cat.key] || [];
    for (let p = 0; p < labels.length; p++) {
      await db.put("habits", {
        id: uid(),
        categoryId: cat.id,
        label: labels[p],
        active: true,
        position: p,
      });
    }
  }

  const profile = (await db.get("profile", "default")) || { id: "default" };
  profile.onboarded = true;
  await db.put("profile", profile);
}
