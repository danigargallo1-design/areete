// Small helpers used across the app.

export const TZ = "Europe/Madrid";

export const todayKey = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

export const formatDate = (value) =>
  new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  })
    .format(new Date(`${value}T12:00:00`))
    .toLocaleUpperCase("es-ES");

export const isMilitaryTime = (value) => /^([01][0-9]|2[0-3])[0-5][0-9]$/.test(value);

export const uid = () =>
  "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
