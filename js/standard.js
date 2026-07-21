// MI ESTÁNDAR — Business logic.
// Aislado de la interfaz. La persistencia se realiza mediante un `driver`
// intercambiable: hoy usa IndexedDB (storage.js). Mañana podría ser
// Supabase, Firebase o cualquier otra base de datos sin reescribir esta
// capa ni la interfaz.

import { db } from "./storage.js";
import { uid } from "./utils.js";

export const MIN_COMMITMENTS = 3;
export const MAX_COMMITMENTS = 12;
export const MAX_LABEL = 40;

// Las cuatro categorías del informe. Orden fijo. No se crean ni se borran.
export const CATEGORY_KEYS = ["thought", "body", "habits", "character"];
export const CATEGORY_TITLES = {
  thought: "EL PENSAMIENTO",
  body: "EL CUERPO",
  habits: "LOS HÁBITOS",
  character: "EL CARÁCTER",
};

// -------------------------------------------------------------
// Driver de persistencia — única capa que conoce la fuente de datos.
// Para migrar a otro backend, basta con reemplazar este objeto.
// -------------------------------------------------------------
const driver = {
  async _findCategory(categoryKey) {
    return db.findOne("categories", (c) => c.key === categoryKey);
  },
  async listByCategory(categoryKey) {
    const cat = await this._findCategory(categoryKey);
    if (!cat) return [];
    const list = await db.findWhere("habits", (h) => h.categoryId === cat.id && h.active);
    return list.sort((a, b) => a.position - b.position);
  },
  async add(categoryKey, label) {
    const cat = await this._findCategory(categoryKey);
    if (!cat) throw new Error("Categoría no encontrada");
    const siblings = await this.listByCategory(categoryKey);
    const item = { id: uid(), categoryId: cat.id, label, active: true, position: siblings.length };
    await db.put("habits", item);
    return item;
  },
  async rename(id, label) {
    const h = await db.get("habits", id);
    if (!h) return;
    h.label = label;
    await db.put("habits", h);
  },
  async remove(id) {
    await db.del("habits", id);
  },
  async reorder(categoryKey, orderedIds) {
    for (let i = 0; i < orderedIds.length; i++) {
      const h = await db.get("habits", orderedIds[i]);
      if (h) { h.position = i; await db.put("habits", h); }
    }
  },
};

// -------------------------------------------------------------
// API pública — usada por la interfaz de MI ESTÁNDAR.
// -------------------------------------------------------------

// Devuelve el estándar completo, ordenado por categoría.
// [{ key, title, commitments: [{ id, label }] }]
export async function getStandard() {
  const result = [];
  for (const key of CATEGORY_KEYS) {
    const items = await driver.listByCategory(key);
    result.push({
      key,
      title: CATEGORY_TITLES[key],
      commitments: items.map((h) => ({ id: h.id, label: h.label })),
    });
  }
  return result;
}

function sanitizeLabel(label) {
  return (label || "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

export async function addCommitment(categoryKey, label) {
  const clean = sanitizeLabel(label);
  if (!clean) throw new Error("El compromiso no puede estar vacío.");
  const list = await driver.listByCategory(categoryKey);
  if (list.length >= MAX_COMMITMENTS) {
    throw new Error(`Máximo ${MAX_COMMITMENTS} compromisos por categoría.`);
  }
  return driver.add(categoryKey, clean);
}

export async function renameCommitment(categoryKey, id, label) {
  const clean = sanitizeLabel(label);
  if (!clean) throw new Error("El compromiso no puede estar vacío.");
  await driver.rename(id, clean);
}

export async function removeCommitment(categoryKey, id) {
  const list = await driver.listByCategory(categoryKey);
  if (list.length <= MIN_COMMITMENTS) {
    throw new Error(`Debes mantener al menos ${MIN_COMMITMENTS} compromisos en esta categoría.`);
  }
  await driver.remove(id);
  // Compactar posiciones para mantener el orden coherente.
  const remaining = await driver.listByCategory(categoryKey);
  await driver.reorder(categoryKey, remaining.map((h) => h.id));
}

export async function moveCommitment(categoryKey, id, delta) {
  const list = await driver.listByCategory(categoryKey);
  const idx = list.findIndex((h) => h.id === id);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= list.length) return;
  const ids = list.map((h) => h.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  await driver.reorder(categoryKey, ids);
}
