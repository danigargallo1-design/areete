// Business logic for the daily ritual — mirrors lib/ritual.ts and the
// seed defaults from the original project, but reads and writes IndexedDB
// through storage.js instead of Prisma.

import { db } from "./storage.js";
import { ensureQuotesSeeded, nextQuote, getQuoteById } from "./quotes.js";
import { todayKey, uid } from "./utils.js";

const HABITS_URL = "./data/habits.json";

async function seedProfile() {
  const p = await db.get("profile", "default");
  if (!p) {
    await db.put("profile", {
      id: "default",
      font: "inter",
      targetBedTime: "2230",
      targetWakeTime: "0530",
      createdAt: new Date().toISOString(),
    });
  }
}

async function seedCategoriesAndHabits() {
  const existing = await db.all("categories");
  if (existing.length > 0) return;
  const defaults = await fetch(HABITS_URL, { cache: "no-store" }).then((r) => r.json());
  for (let i = 0; i < defaults.length; i++) {
    const def = defaults[i];
    const category = {
      id: uid(),
      key: def.key,
      title: def.title,
      enabled: true,
      position: i,
    };
    await db.put("categories", category);
    for (let p = 0; p < def.habits.length; p++) {
      await db.put("habits", {
        id: uid(),
        categoryId: category.id,
        label: def.habits[p],
        active: true,
        position: p,
      });
    }
  }
}

export async function seedDefaults() {
  await ensureQuotesSeeded();
  await seedProfile();
  await seedCategoriesAndHabits();
}

export async function ensureToday() {
  const date = todayKey();
  let day = await db.findOne("days", (d) => d.date === date);
  if (!day) {
    const quote = await nextQuote(false);
    const activeCats = (await db.all("categories")).filter((c) => c.enabled);
    const activeCatIds = new Set(activeCats.map((c) => c.id));
    const habits = (await db.all("habits")).filter((h) => h.active && activeCatIds.has(h.categoryId));
    day = {
      id: uid(),
      date,
      status: "DRAFT",
      quoteId: quote?.id ?? null,
      finalQuoteId: null,
      bedTime: null,
      wakeTime: null,
      firstHour: null,
      good: null,
      bad: null,
      tomorrow: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    await db.put("days", day);
    for (const h of habits) {
      await db.put("entries", {
        id: uid(),
        dayId: day.id,
        habitId: h.id,
        checked: false,
      });
    }
  }
  return day;
}

const quoteOf = (q) => (q ? { text: q.text, author: q.author } : null);

export async function getRitual(date) {
  const key = date || todayKey();
  if (key === todayKey()) await ensureToday();
  const day = await db.findOne("days", (d) => d.date === key);
  if (!day) return null;
  const [quoteA, quoteB] = await Promise.all([
    getQuoteById(day.quoteId),
    getQuoteById(day.finalQuoteId),
  ]);
  const base = {
    id: day.id,
    date: day.date,
    status: day.status,
    quote: quoteOf(quoteA),
    finalQuote: quoteOf(quoteB),
    bedTime: day.bedTime ?? "",
    wakeTime: day.wakeTime ?? "",
    firstHour: day.firstHour ?? "",
    good: day.good ?? "",
    bad: day.bad ?? "",
    tomorrow: day.tomorrow ?? "",
  };
  // Los informes emitidos leen del snapshot congelado en finalizeDay.
  // Así, cualquier cambio posterior en MI ESTÁNDAR nunca reescribe la
  // historia: los informes antiguos permanecen intactos.
  if (day.status === "COMPLETED" && Array.isArray(day.commitmentsSnapshot)) {
    return {
      ...base,
      categories: day.commitmentsSnapshot.map((c) => ({
        id: c.key,
        key: c.key,
        title: c.title,
        enabled: true,
        habits: (c.habits || []).map((h) => ({
          id: h.habitId,
          label: h.label,
          active: true,
          checked: !!h.checked,
        })),
      })),
    };
  }
  // Día en curso: el ritual se construye dinámicamente con el estándar actual.
  const [categoriesRaw, habitsRaw, entriesRaw] = await Promise.all([
    db.all("categories"),
    db.all("habits"),
    db.findWhere("entries", (e) => e.dayId === day.id),
  ]);
  const categories = [...categoriesRaw].sort((a, b) => a.position - b.position);
  const entryMap = new Map(entriesRaw.map((e) => [e.habitId, e.checked]));
  return {
    ...base,
    categories: categories
      .filter((c) => c.enabled)
      .map((c) => ({
        id: c.id,
        key: c.key,
        title: c.title,
        enabled: c.enabled,
        habits: habitsRaw
          .filter((h) => h.categoryId === c.id && h.active)
          .sort((a, b) => a.position - b.position)
          .map((h) => ({
            id: h.id,
            label: h.label,
            active: h.active,
            checked: entryMap.get(h.id) ?? false,
          })),
      })),
  };
}

export async function toggleEntry(dayId, habitId, checked) {
  const day = await db.get("days", dayId);
  if (!day) throw new Error("Día no encontrado");
  if (day.status === "COMPLETED") throw new Error("El pasado es de solo lectura");
  const entries = await db.findWhere("entries", (e) => e.dayId === dayId && e.habitId === habitId);
  if (entries.length > 0) {
    const entry = entries[0];
    entry.checked = checked;
    await db.put("entries", entry);
  } else {
    await db.put("entries", { id: uid(), dayId, habitId, checked });
  }
}

const isMilitaryTime = (v) => /^([01][0-9]|2[0-3])[0-5][0-9]$/.test(v);

export async function updateFields(dayId, fields) {
  const day = await db.get("days", dayId);
  if (!day) throw new Error("Día no encontrado");
  if (day.status === "COMPLETED") throw new Error("El pasado es de solo lectura");
  const allowed = ["bedTime", "wakeTime", "firstHour", "good", "bad", "tomorrow"];
  for (const k of allowed) {
    if (k in fields) {
      if ((k === "bedTime" || k === "wakeTime") && fields[k] && !isMilitaryTime(fields[k])) {
        throw new Error("La hora debe usar el formato 2235");
      }
      day[k] = fields[k];
    }
  }
  await db.put("days", day);
}

export async function verdictFor(dayId) {
  const day = await db.get("days", dayId);
  const entries = await db.findWhere("entries", (e) => e.dayId === dayId);
  const habits = await db.all("habits");
  const categories = await db.all("categories");
  const habitMap = new Map(habits.map((h) => [h.id, h]));
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const score = (items) =>
    items.reduce((total, entry) => {
      if (!entry.checked) return total;
      const habit = habitMap.get(entry.habitId);
      const category = habit ? catMap.get(habit.categoryId) : null;
      return total + (category && category.key === "character" ? -1 : 1);
    }, 0);

  // Puntúa a partir de un snapshot congelado (informes emitidos).
  const scoreSnapshot = (snapshot) =>
    (snapshot || []).reduce((total, cat) => {
      const sign = cat.key === "character" ? -1 : 1;
      const hits = (cat.habits || []).filter((h) => h.checked).length;
      return total + sign * hits;
    }, 0);

  const today = score(entries);

  const previous = (await db.all("days"))
    .filter((d) => d.status === "COMPLETED" && d.date < day.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  let yesterday = null;
  if (previous) {
    // El día anterior siempre está COMPLETED, así que si tiene snapshot,
    // lo usamos; si no (informes antiguos previos a esta versión), caemos
    // al conteo por entradas.
    if (Array.isArray(previous.commitmentsSnapshot)) {
      yesterday = scoreSnapshot(previous.commitmentsSnapshot);
    } else {
      const prevEntries = await db.findWhere("entries", (e) => e.dayId === previous.id);
      yesterday = score(prevEntries);
    }
  }

  const message =
    yesterday === null
      ? "No existe un día anterior con el que comparar."
      : today > yesterday
      ? "Has mejorado respecto al último día registrado."
      : today < yesterday
      ? "Has retrocedido respecto al último día registrado."
      : "Has mantenido la misma medida que el último día registrado.";

  const streaks = [];
  const readHabit = habits.find((h) => h.label === "Leer");
  if (readHabit) {
    const recent = (await db.all("days"))
      .filter((d) => d.date < day.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 10);
    let days = 0;
    for (const item of recent) {
      const entry = (await db.findWhere("entries", (e) => e.dayId === item.id && e.habitId === readHabit.id))[0];
      if (entry?.checked) break;
      days++;
    }
    if (days >= 2) streaks.push(`Hace ${days} días que no lees.`);
  }
  return { today, yesterday, message, streaks };
}

export async function finalizeDay(dayId) {
  const final = await nextQuote(true);
  const day = await db.get("days", dayId);
  // Congelamos el estándar del día para que futuros cambios en MI ESTÁNDAR
  // nunca reescriban este informe. El histórico es inmutable.
  const [cats, habs, entries] = await Promise.all([
    db.all("categories"),
    db.all("habits"),
    db.findWhere("entries", (e) => e.dayId === dayId),
  ]);
  const habitMap = new Map(habs.map((h) => [h.id, h]));
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const catSnapshots = new Map();
  for (const c of cats.filter((x) => x.enabled).sort((a, b) => a.position - b.position)) {
    catSnapshots.set(c.id, { key: c.key, title: c.title, position: c.position, habits: [] });
  }
  for (const e of entries) {
    const h = habitMap.get(e.habitId);
    if (!h || !h.active) continue;
    const cat = catMap.get(h.categoryId);
    if (!cat || !catSnapshots.has(cat.id)) continue;
    catSnapshots.get(cat.id).habits.push({
      habitId: h.id,
      label: h.label,
      checked: !!e.checked,
      position: h.position,
    });
  }
  day.commitmentsSnapshot = Array.from(catSnapshots.values()).map((c) => ({
    ...c,
    habits: c.habits.sort((a, b) => a.position - b.position),
  }));
  day.status = "COMPLETED";
  day.completedAt = new Date().toISOString();
  day.finalQuoteId = final?.id ?? null;
  await db.put("days", day);
}

export async function historyList() {
  const days = (await db.all("days"))
    .filter((d) => d.status === "COMPLETED")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const habits = await db.all("habits");
  const categories = await db.all("categories");
  const habitMap = new Map(habits.map((h) => [h.id, h]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const results = [];
  for (const d of days) {
    let score;
    if (Array.isArray(d.commitmentsSnapshot)) {
      // Usa el estándar congelado: la historia nunca cambia.
      score = d.commitmentsSnapshot.reduce((n, cat) => {
        const sign = cat.key === "character" ? -1 : 1;
        const hits = (cat.habits || []).filter((h) => h.checked).length;
        return n + sign * hits;
      }, 0);
    } else {
      // Informe emitido antes de esta versión: caemos al conteo por entradas.
      const entries = await db.findWhere("entries", (e) => e.dayId === d.id);
      score = entries.reduce((n, e) => {
        if (!e.checked) return n;
        const h = habitMap.get(e.habitId);
        const c = h ? catMap.get(h.categoryId) : null;
        return n + (c && c.key === "character" ? -1 : 1);
      }, 0);
    }
    results.push({ date: d.date, score });
  }
  return results;
}
