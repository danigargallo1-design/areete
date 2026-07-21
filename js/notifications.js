// Sistema de notificaciones locales para ARETÉ.
//
// Todo el módulo es autónomo: no depende de servidores, ni de push, ni de
// ninguna API externa. Únicamente utiliza el Service Worker de la PWA y
// setTimeout local para programar los siguientes recordatorios mientras la
// aplicación esté abierta o el Service Worker permanezca vivo.
//
// Este archivo se encarga de:
//   - solicitar permisos
//   - programar recordatorios en función de la frecuencia y el rango horario
//   - seleccionar la siguiente frase sin repetirla hasta agotar la colección
//   - persistir la configuración y el estado en localStorage
//   - reprogramar el próximo aviso cuando la app vuelve a primer plano
//
// El módulo NO modifica el diseño existente. Solo aporta el motor de
// notificaciones. La integración con la UI (pantalla de permiso y sección
// de Ajustes) reside en app.js y settings.js.

const CONFIG_KEY = "arete.notifications.config";
const STATE_KEY  = "arete.notifications.state";
const NOTIFICATIONS_URL = "./data/notifications.json";

// Configuración por defecto — deshabilitada hasta que el usuario la active.
const DEFAULT_CONFIG = {
  enabled: false,          // ¿Está activado el sistema?
  frequency: 1,            // Horas entre recordatorios: 1, 2, 3 o 4.
  startTime: "0500",       // Hora inicial (HHMM, 24h).
  endTime:   "2200",       // Hora final   (HHMM, 24h).
  permissionAsked: false,  // ¿Ya se solicitó el permiso al usuario?
};

// Estado interno: qué frases se han utilizado en el ciclo actual.
// Al agotar la colección se reinicia (según especificación).
const DEFAULT_STATE = { usedIds: [] };

let scheduledTimer = null;
let phrasesCache = null;

// ─────────────────────────────────────────────────────────────
// Persistencia
// ─────────────────────────────────────────────────────────────
export function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setConfig(patch) {
  const merged = { ...getConfig(), ...patch };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(merged)); } catch { /* almacenamiento no disponible */ }
  return merged;
}

function getState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function setState(patch) {
  const merged = { ...getState(), ...patch };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(merged)); } catch { /* almacenamiento no disponible */ }
  return merged;
}

// ─────────────────────────────────────────────────────────────
// Compatibilidad
// ─────────────────────────────────────────────────────────────
export function isSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

export function permissionStatus() {
  if (!isSupported()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

// Marca el permiso como solicitado para no volver a preguntar
// automáticamente. El usuario podrá activarlo desde Ajustes.
export function markPermissionAsked() {
  setConfig({ permissionAsked: true });
}

// ¿Debe mostrarse la pantalla inicial de permiso?
// Solo la primera vez, si el navegador soporta notificaciones y el
// usuario aún no ha decidido nada.
export function shouldPromptFirstTime() {
  if (!isSupported()) return false;
  const cfg = getConfig();
  if (cfg.permissionAsked) return false;
  return Notification.permission === "default";
}

// Solicita el permiso oficial de notificaciones. Devuelve el estado final.
export async function requestPermission() {
  if (!isSupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    markPermissionAsked();
    return result;
  } catch {
    markPermissionAsked();
    return "denied";
  }
}

// ─────────────────────────────────────────────────────────────
// Frases
// ─────────────────────────────────────────────────────────────
async function loadPhrases() {
  if (phrasesCache) return phrasesCache;
  try {
    const res = await fetch(NOTIFICATIONS_URL, { cache: "no-store" });
    const data = await res.json();
    phrasesCache = Array.isArray(data) ? data.filter((p) => p && p.id && p.text) : [];
  } catch {
    phrasesCache = [];
  }
  return phrasesCache;
}

// Selecciona la siguiente frase aleatoriamente sin repetir hasta agotar
// la colección; entonces reinicia el ciclo.
async function pickNextPhrase() {
  const phrases = await loadPhrases();
  if (phrases.length === 0) return null;

  let { usedIds } = getState();
  // Sanea: descarta ids que ya no existan en la colección actual.
  const validSet = new Set(phrases.map((p) => p.id));
  usedIds = usedIds.filter((id) => validSet.has(id));

  let remaining = phrases.filter((p) => !usedIds.includes(p.id));
  if (remaining.length === 0) {
    // Colección agotada — reiniciar ciclo.
    usedIds = [];
    remaining = phrases.slice();
  }
  const chosen = remaining[Math.floor(Math.random() * remaining.length)];
  setState({ usedIds: [...usedIds, chosen.id] });
  return chosen;
}

// ─────────────────────────────────────────────────────────────
// Cálculo del próximo instante en el que disparar la notificación
// ─────────────────────────────────────────────────────────────

// Convierte "HHMM" en minutos desde 00:00. Devuelve null si no es válido.
function hhmmToMinutes(s) {
  if (typeof s !== "string" || !/^\d{4}$/.test(s)) return null;
  const h = parseInt(s.slice(0, 2), 10);
  const m = parseInt(s.slice(2, 4), 10);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// Devuelve un objeto Date con el próximo momento válido de disparo,
// o null si la configuración no permite ninguno.
export function computeNextFire(now = new Date(), cfg = getConfig()) {
  if (!cfg.enabled) return null;
  const startMin = hhmmToMinutes(cfg.startTime);
  const endMin   = hhmmToMinutes(cfg.endTime);
  const freq     = [1, 2, 3, 4].includes(cfg.frequency) ? cfg.frequency : 1;
  if (startMin === null || endMin === null || endMin < startMin) return null;

  const stepMin = freq * 60;

  // Explora el día actual y el siguiente para encontrar el próximo slot.
  for (let dayOffset = 0; dayOffset < 2; dayOffset++) {
    const base = new Date(now);
    base.setDate(base.getDate() + dayOffset);
    base.setHours(0, 0, 0, 0);
    for (let m = startMin; m <= endMin; m += stepMin) {
      const candidate = new Date(base.getTime() + m * 60000);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Programación y disparo
// ─────────────────────────────────────────────────────────────

// Muestra la notificación a través del Service Worker (funciona incluso
// cuando la pestaña no está en primer plano, siempre que el SW siga vivo).
async function showNotification(text) {
  if (!isSupported()) return;
  if (Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.showNotification("ARETÉ", {
      body: text,
      icon: "./assets/icon-192.png",
      badge: "./assets/icon-192.png",
      tag: "arete-reminder",
      renotify: true,
      silent: false,
      data: { url: "./index.html" },
    });
  } catch {
    // Silencio: nunca producir errores en el usuario.
  }
}

function clearScheduled() {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

// Programa el próximo aviso. Si la configuración no lo permite, no hace nada.
async function schedule() {
  clearScheduled();
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (!isSupported() || Notification.permission !== "granted") return;

  const next = computeNextFire(new Date(), cfg);
  if (!next) return;

  const delay = Math.max(0, next.getTime() - Date.now());
  // setTimeout admite hasta ~24.8 días; nuestros intervalos son de horas,
  // por lo que siempre cabe. Añadimos un pequeño colchón defensivo.
  const safeDelay = Math.min(delay, 24 * 60 * 60 * 1000);

  scheduledTimer = setTimeout(async () => {
    scheduledTimer = null;
    const phrase = await pickNextPhrase();
    if (phrase) await showNotification(phrase.text);
    // Encadena el siguiente aviso.
    schedule();
  }, safeDelay);
}

// Reprograma cuando la app vuelve a primer plano (los timers pueden haber
// muerto mientras la app estaba en segundo plano en Android).
function attachLifecycleHooks() {
  if (attachLifecycleHooks._done) return;
  attachLifecycleHooks._done = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule();
  });
  window.addEventListener("focus", () => schedule());
  window.addEventListener("pageshow", () => schedule());
}

// Punto de entrada. Llámalo una vez tras registrar el Service Worker.
// No modifica el flujo ni la UI; solo activa el motor si procede.
export async function init() {
  if (!isSupported()) return;
  attachLifecycleHooks();
  // Espera a que el Service Worker esté listo para que showNotification
  // encuentre un registration válido.
  try { await navigator.serviceWorker.ready; } catch { /* sin SW no hay notificaciones */ }
  schedule();
}

// Aplica una nueva configuración desde Ajustes y reprograma.
export async function applyConfig(patch) {
  const cfg = setConfig(patch);
  // Si se ha desactivado, cancelar cualquier aviso pendiente.
  if (!cfg.enabled) clearScheduled();
  await init();
  return cfg;
}

// Utilidad expuesta para la pantalla inicial: activa las notificaciones
// tras aceptar el permiso.
export async function enableAfterFirstPrompt() {
  const status = await requestPermission();
  if (status === "granted") {
    setConfig({ enabled: true });
    await init();
  }
  return status;
}
