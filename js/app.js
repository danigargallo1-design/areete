// Flujo del ritual — ARETÉ como parte oficial de rendición de cuentas.
// La lógica es intacta; se reforma únicamente la sensación, el vocabulario y
// el orden visual.

import { initNotifications } from "./firebase.js";

import { seedDefaults, ensureToday, getRitual, toggleEntry, updateFields, finalizeDay, verdictFor } from "./ritual.js";
import { needsOnboarding, runOnboarding } from "./onboarding.js";
import { mountScreen, mountLoading, el, textArea, timeField, choiceList } from "./ui.js";
import { replaceScreen, flashOverlay } from "./transitions.js";
import { formatDate } from "./utils.js";
import { db } from "./storage.js";
import * as notifications from "./notifications.js";


window.addEventListener("load", async () => {
  await initNotifications();
});


let day = null;
let verdict = null;
let step = 0;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const pad3 = (n) => String(n).padStart(3, "0");

function hhmmFromISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}${mm}`;
}

// -------------------------------------------------------------
// Intro — comparecencia. Logo, ARETÉ, ἀρετή, definición.
// Se monta como pantalla única a través del motor de transiciones.
// -------------------------------------------------------------
async function renderIntro() {
  await replaceScreen(() => {
    const intro = document.createElement("div");
    intro.className = "intro-screen";
    intro.innerHTML = `
      <div class="intro-content">
        <img class="intro-logo" src="./assets/logo.svg" alt="ARETÉ" width="72" height="72" draggable="false" />
        <h1 class="intro-title">ARETÉ</h1>
        <p class="intro-greek">ἀρετή</p>
        <p class="intro-desc">Excelencia. Virtud. La realización del máximo potencial humano mediante la disciplina y el carácter.</p>
      </div>
    `;
    return intro;
  });
  // Tiempo de lectura del contenido antes de disolver.
  await new Promise((r) => setTimeout(r, 2600));
}

// -------------------------------------------------------------
// Prompt de recordatorios (una sola vez).
// -------------------------------------------------------------
function renderNotificationsPrompt() {
  return new Promise((resolve) => {
    replaceScreen(() => {
      const section = document.createElement("section");
      section.className = "screen";
      const content = document.createElement("div");
      content.className = "screen-content";
      const wrap = document.createElement("div");
      wrap.className = "notif-prompt";

      const hint = document.createElement("p");
      hint.className = "notif-hint";
      hint.textContent = "RECORDATORIOS";

      const body = document.createElement("p");
      body.className = "notif-body";
      body.textContent = "ARETÉ puede recordarte a lo largo del día el compromiso adquirido.";

      const btn = document.createElement("button");
      btn.className = "notif-activate";
      btn.type = "button";
      btn.textContent = "ACTIVAR";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        await notifications.enableAfterFirstPrompt();
        resolve();
      }, { once: true });

      wrap.append(hint, body, btn);
      content.appendChild(wrap);
      section.appendChild(content);
      return section;
    });
  });
}

// -------------------------------------------------------------
// Boot.
// -------------------------------------------------------------
async function boot() {
  await renderIntro();
  if (notifications.shouldPromptFirstTime()) {
    await renderNotificationsPrompt();
  }
  notifications.init();
  mountLoading("ABRIENDO EL REGISTRO");
  try {
    await seedDefaults();
    if (await needsOnboarding()) {
      await runOnboarding();
    }
    const profile = await db.get("profile", "default");
    document.documentElement.dataset.font = profile?.font ?? "inter";
    await ensureToday();
    day = await getRitual();
    if (!day) throw new Error("No se ha podido abrir el registro.");
    // Si el informe está emitido → pantalla principal.
    // Si está pendiente → cita de apertura y comienza automáticamente.
    if (day.status === "COMPLETED") {
      await renderHome();
    } else {
      renderOpening();
    }
  } catch (e) {
    mountLoading(e.message || "NO SE HA PODIDO ABRIR EL REGISTRO.");
  }
}

async function reloadDay() {
  day = await getRitual();
}

// -------------------------------------------------------------
// Pantalla principal — parte diario.
// -------------------------------------------------------------
async function renderHome() {
  const allDays = await db.all("days");
  const completed = allDays.filter((d) => d.status === "COMPLETED");
  const rawToday = allDays.find((d) => d.id === day.id);
  if (rawToday) day.completedAt = rawToday.completedAt;
  const dayNumber = day.status === "COMPLETED"
    ? completed.length
    : completed.length + 1;

  await replaceScreen(() => {
    return el("section", { class: "home" }, [
      el("p", { class: "day-number", text: `DÍA ${pad3(dayNumber)}` }),
      el("p", { class: "home-date", text: formatDate(day.date) }),
      day.status === "COMPLETED"
        ? el("p", { class: "home-status", text: "INFORME EMITIDO" })
        : el("p", { class: "home-status", text: "INFORME PENDIENTE" }),
      day.status === "COMPLETED"
        ? el("p", { class: "home-time", text: hhmmFromISO(day.completedAt || day.completedAtISO) })
        : el("button", {
            class: "bottom-action",
            style: "width:auto;padding:0 24px;margin:0 0 56px;",
            text: "EMITIR INFORME",
            onClick: () => { step = 0; renderOpening(); },
          }),
      el("div", { class: "home-nav" }, [
        el("a", { href: "./history.html", text: "ARCHIVO" }),
        el("a", { href: "./settings.html", text: "MI ESTÁNDAR" }),
      ]),
    ]);
  });
}

// Fetch completed timestamp — day object exposes completedAt via ritual.
// (Necesitamos volver a leerlo directamente porque getRitual proyecta.)
async function refreshDayRaw() {
  const raw = await db.findOne("days", (d) => d.id === day.id);
  if (raw) {
    day.completedAt = raw.completedAt;
    day.status = raw.status;
  }
}

// -------------------------------------------------------------
// Router del ritual (sin cambios de lógica).
// -------------------------------------------------------------
function next() {
  const restStep = day.categories.length + 1;
  const reportStep = restStep + 1;
  const verdictStep = reportStep + 1;
  step = Math.min(step + 1, verdictStep);
  // Overlay "SECCIÓN COMPLETADA" — la pantalla anterior debe haberse
  // desmontado por completo antes de mostrar este texto, y este texto debe
  // desaparecer por completo antes de que aparezca la siguiente sección.
  flashOverlay("SECCIÓN COMPLETADA", { holdMs: 350 }).then(route);
}

function route() {
  const restStep = day.categories.length + 1;
  const reportStep = restStep + 1;
  const verdictStep = reportStep + 1;
  if (step === 0) return renderOpening();
  if (step >= 1 && step < restStep) return renderCategory(day.categories[step - 1], step - 1);
  if (step === restStep) return renderRest(step - 1);
  if (step === reportStep) return renderReport(step - 1);
  if (step === verdictStep) return renderVerdict();
}

// -------------------------------------------------------------
// Apertura — fecha + cita, sin interacción. Es una pantalla más.
// El fade lo gestiona el motor: ninguna transición interna.
// -------------------------------------------------------------
function renderOpening() {
  step = 0;
  mountScreen(() => {
    const opening = el("div", { class: "opening ritual-center" }, [
      el("p", { class: "date", text: formatDate(day.date) }),
      el("div", { class: "quote" }, [
        el("p", { text: `«${day.quote?.text ?? ""}»` }),
        el("small", { text: day.quote?.author ?? "" }),
      ]),
    ]);
    // Tras un tiempo de lectura, la pantalla completa se desmonta y aparece
    // la primera sección. Nunca coexisten.
    setTimeout(() => { step = 1; route(); }, 5000);
    return opening;
  });
}

// Encabezado con SECCIÓN N + título.
function sectionTitle(index, title) {
  const tag = `SECCIÓN ${ROMAN[index] || (index + 1)}`;
  const h = el("h1", {}, []);
  h.appendChild(el("span", { class: "section-tag", text: tag }));
  h.appendChild(document.createTextNode(title));
  return h;
}

// -------------------------------------------------------------
// Secciones — compromisos e incidencias.
// -------------------------------------------------------------
function renderCategory(category, sectionIndex) {
  mountScreen(
    () => {
      const wrap = el("div", { class: "ritual-center section-content" }, [
        sectionTitle(sectionIndex, category.title),
        category.key === "character"
          ? el("p", { class: "hint", text: "Marca las incidencias registradas hoy." })
          : null,
        choiceList(category, async (habitId, checked) => {
          try {
            await toggleEntry(day.id, habitId, checked);
            await reloadDay();
            const rows = wrap.querySelectorAll(".choice-row");
            const cat = day.categories.find((c) => c.id === category.id);
            if (cat) {
              cat.habits.forEach((h, i) => {
                const check = rows[i]?.querySelector(".check");
                if (check) check.className = "check" + (h.checked ? " checked" : "");
              });
              category.habits = cat.habits;
            }
          } catch (e) {
            window.alert(e.message);
          }
        }),
      ]);
      return wrap;
    },
    { action: next, label: "CONFIRMAR" }
  );
}

// -------------------------------------------------------------
// Descanso — formato militar 2230.
// -------------------------------------------------------------
function renderRest(sectionIndex) {
  mountScreen(
    () => {
      const commit = async (fields) => {
        try { await updateFields(day.id, fields); await reloadDay(); }
        catch (e) { window.alert(e.message); }
      };
      return el("div", { class: "ritual-center section-content" }, [
        sectionTitle(sectionIndex, "EL DESCANSO"),
        el("div", { class: "form-stack" }, [
          timeField({ label: "HORA DE ACOSTARSE", value: day.bedTime, commit: (bedTime) => commit({ bedTime }) }),
          timeField({ label: "HORA DE LEVANTARSE", value: day.wakeTime, commit: (wakeTime) => commit({ wakeTime }) }),
          el("label", { class: "question", text: "PRIMERA HORA DEL DÍA" }),
          textArea({ value: day.firstHour, placeholder: "", onCommit: (firstHour) => commit({ firstHour }) }),
        ]),
      ]);
    },
    { action: next, label: "CONFIRMAR" }
  );
}

// -------------------------------------------------------------
// Informe — observaciones.
// -------------------------------------------------------------
function renderReport(sectionIndex) {
  mountScreen(
    () => {
      const commit = async (fields) => {
        try { await updateFields(day.id, fields); await reloadDay(); }
        catch (e) { window.alert(e.message); }
      };
      return el("div", { class: "ritual-center section-content" }, [
        sectionTitle(sectionIndex, "OBSERVACIONES"),
        el("div", { class: "form-stack report" }, [
          el("label", { class: "question", text: "CONDUCTA CORRECTA" }),
          textArea({ value: day.good, placeholder: "", onCommit: (good) => commit({ good }) }),
          el("label", { class: "question", text: "CONDUCTA INCORRECTA" }),
          textArea({ value: day.bad, placeholder: "", onCommit: (bad) => commit({ bad }) }),
          el("label", { class: "question", text: "DISPOSICIÓN PARA MAÑANA" }),
          textArea({ value: day.tomorrow, placeholder: "", onCommit: (tomorrow) => commit({ tomorrow }) }),
        ]),
      ]);
    },
    {
      action: async () => {
        try {
          await finalizeDay(day.id);
          await reloadDay();
          await refreshDayRaw();
          verdict = await verdictFor(day.id);
          renderVerdict();
        } catch (e) { window.alert(e.message); }
      },
      label: "EMITIR INFORME",
    }
  );
}

// -------------------------------------------------------------
// Veredicto — recuento seco, comparación y cita final.
// -------------------------------------------------------------
function computeCompliance(dayLike) {
  const commitments = (dayLike?.categories ?? []).filter((c) => c.key !== "character");
  const incidents   = (dayLike?.categories ?? []).filter((c) => c.key === "character");
  let cumplidos = 0, totalCompromisos = 0, incidencias = 0, totalIncidencias = 0;
  for (const c of commitments) for (const h of c.habits) {
    totalCompromisos++;
    if (h.checked) cumplidos++;
  }
  for (const c of incidents) for (const h of c.habits) {
    totalIncidencias++;
    if (h.checked) incidencias++;
  }
  return { cumplidos, totalCompromisos, incidencias, totalIncidencias };
}

async function fetchPreviousCompliance() {
  const days = (await db.all("days"))
    .filter((d) => d.status === "COMPLETED" && d.date < day.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const prev = days[0];
  if (!prev) return null;
  const previous = await getRitual(prev.date);
  if (!previous) return null;
  return { date: prev.date, ...computeCompliance(previous) };
}

async function renderVerdict() {
  const today = computeCompliance(day);
  const previous = await fetchPreviousCompliance();

  let comparison = "SIN REGISTRO ANTERIOR PARA COMPARAR.";
  if (previous) {
    if (today.cumplidos > previous.cumplidos) comparison = "HAS MEJORADO RESPECTO A AYER.";
    else if (today.cumplidos < previous.cumplidos) comparison = "HAS RETROCEDIDO RESPECTO A AYER.";
    else comparison = "HAS MANTENIDO EL ESTÁNDAR.";
  }

  mountScreen(
    () => {
      const wrap = el("div", { class: "verdict ritual-center" }, [
        el("p", { class: "verdict-title", text: "VEREDICTO" }),

        el("div", { class: "verdict-block" }, [
          el("span", { class: "label", text: "COMPROMISOS CUMPLIDOS" }),
          el("span", { class: "figure", text: `${today.cumplidos} / ${today.totalCompromisos}` }),
        ]),
        el("div", { class: "verdict-block" }, [
          el("span", { class: "label", text: "COMPROMISOS INCUMPLIDOS" }),
          el("span", { class: "figure", text: `${today.totalCompromisos - today.cumplidos} / ${today.totalCompromisos}` }),
        ]),
        today.totalIncidencias > 0
          ? el("div", { class: "verdict-block" }, [
              el("span", { class: "label", text: "INCIDENCIAS REGISTRADAS" }),
              el("span", { class: "figure", text: `${today.incidencias} / ${today.totalIncidencias}` }),
            ])
          : null,

        el("div", { class: "verdict-compare" }, [
          el("div", {}, [
            el("span", { class: "label", text: "AYER" }),
            el("span", { class: "figure", text: previous ? `${previous.cumplidos} / ${previous.totalCompromisos}` : "—" }),
          ]),
          el("div", {}, [
            el("span", { class: "label", text: "HOY" }),
            el("span", { class: "figure", text: `${today.cumplidos} / ${today.totalCompromisos}` }),
          ]),
        ]),

        el("p", { class: "verdict-verdict", text: comparison }),

        ...(verdict?.streaks ?? []).map((item) =>
          el("p", { class: "verdict-streaks", text: item.toUpperCase() })
        ),

        el("div", { class: "final-quote" }, [
          el("p", { text: `«${day.finalQuote?.text ?? day.quote?.text ?? ""}»` }),
          el("small", { text: day.finalQuote?.author ?? day.quote?.author ?? "" }),
        ]),
      ]);
      return wrap;
    },
    {
      action: () => archiveAndReturnHome(),
      label: "ARCHIVAR INFORME",
    }
  );
}

// -------------------------------------------------------------
// Cierre — ARCHIVANDO / ARCHIVADO / vuelta a principal.
// Se apoya en `flashOverlay`: la pantalla del veredicto desaparece
// completamente antes de mostrar "ARCHIVANDO INFORME…", y el overlay
// desaparece completamente antes de que aparezca la pantalla principal.
// -------------------------------------------------------------
async function archiveAndReturnHome() {
  await flashOverlay("ARCHIVANDO INFORME…", {
    render: async (node) => {
      await new Promise((r) => setTimeout(r, 900));
      node.textContent = "INFORME ARCHIVADO";
      await new Promise((r) => setTimeout(r, 900));
    },
  });
  await refreshDayRaw();
  day = await getRitual();
  renderHome();
}

boot();
