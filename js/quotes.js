// Loads quote files from /data/quotes/ and syncs them into IndexedDB the
// first time the app starts. Selection semantics match the original:
// pick the least-recently-shown active quote, respecting showAtStart / showAtEnd.

import { db } from "./storage.js";
import { uid } from "./utils.js";

const INDEX_URL = "./data/quotes/index.json";

async function loadFromJson() {
  const index = await fetch(INDEX_URL, { cache: "no-store" }).then((r) => r.json());
  const files = await Promise.all(
    index.map((file) =>
      fetch(`./data/quotes/${file}`, { cache: "no-store" }).then((r) => r.json())
    )
  );
  const all = [];
  for (const file of files) {
    for (const q of file.quotes) all.push(q);
  }
  return all;
}

function quoteId(q) {
  // Deterministic id so re-seeding does not duplicate rows.
  return "q-" + btoa(unescape(encodeURIComponent(q.author + "|" + q.text))).slice(0, 32);
}

export async function ensureQuotesSeeded() {
  const existing = await db.all("quotes");
  if (existing.length > 0) return;
  const list = await loadFromJson();
  const items = list.map((q) => ({
    id: quoteId(q),
    text: q.text,
    author: q.author,
    category: q.category ?? "",
    language: q.language ?? "es",
    active: q.active !== false,
    showAtStart: q.showAtStart !== false,
    showAtEnd: !!q.showAtEnd,
    lastShownAt: null,
  }));
  await db.bulkPut("quotes", items);
}

export async function nextQuote(final = false) {
  const all = await db.all("quotes");
  const filter = (q) => q.active && (final ? q.showAtEnd : q.showAtStart);
  let pool = all.filter(filter);
  if (pool.length === 0 && final) pool = all.filter((q) => q.active);
  if (pool.length === 0) return null;
  pool.sort((a, b) => {
    const av = a.lastShownAt ? new Date(a.lastShownAt).getTime() : 0;
    const bv = b.lastShownAt ? new Date(b.lastShownAt).getTime() : 0;
    return av - bv;
  });
  const quote = pool[0];
  quote.lastShownAt = new Date().toISOString();
  await db.put("quotes", quote);
  return quote;
}

export async function getQuoteById(id) {
  if (!id) return null;
  return (await db.get("quotes", id)) ?? null;
}
