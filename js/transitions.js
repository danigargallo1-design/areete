// -----------------------------------------------------------------------------
// ARETÉ — Sistema de transiciones (arquitectura de hoja única).
//
// Regla dura: solo puede existir UNA pantalla en el DOM. Toda transición sigue
// el orden estricto exigido por el diseño:
//
//   1. La pantalla actual inicia fade-out.
//   2. Se espera a que opacity sea exactamente 0 (transitionend).
//   3. Un rAF adicional para garantizar el commit del frame negro.
//   4. Se desmonta completamente del DOM.
//   5. La nueva pantalla se construye con opacity:0.
//   6. Se fuerza layout (offsetHeight) y otro rAF.
//   7. Fade-in a opacity:1.
//   8. Se espera a que el fade-in termine antes de aceptar otra transición.
//
// Nunca se montan dos pantallas a la vez. Nunca se usa display:none, ni
// visibility:hidden, ni pantallas apiladas con position:absolute.
// -----------------------------------------------------------------------------

export const TRANSITION_MS = 350;

// Cola serializada de transiciones — impide solapamientos si el usuario pulsa
// más rápido de lo que dura una animación.
let running = false;
const queue = [];

function acquire() {
  if (!running) {
    running = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else running = false;
}

function twoFrames() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

// Espera un `transitionend` sobre la propiedad `opacity`, con un tope de
// seguridad por si el navegador se salta el evento (pestaña en background,
// etc.). El tope es siempre mayor que la duración configurada.
function waitOpacityEnd(node, extraMs = 80) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      node.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target === node && e.propertyName === "opacity") finish();
    };
    node.addEventListener("transitionend", onEnd);
    setTimeout(finish, TRANSITION_MS + extraMs);
  });
}

const appRoot = () => document.getElementById("app");

// Fade-out sobre `node`. Al terminar, `node` sigue en el DOM (lo desmonta el
// llamador tras el rAF de gracia). Reflow forzado para garantizar la
// transición cuando el nodo se acaba de mostrar.
function fadeOut(node) {
  node.classList.add("layer");
  // Asegura estado visible antes de disparar el fade-out.
  if (!node.classList.contains("is-visible")) {
    node.classList.add("is-visible");
    void node.offsetHeight;
  }
  node.classList.remove("is-visible");
  return waitOpacityEnd(node);
}

function fadeIn(node) {
  node.classList.add("layer");
  // Nace invisible.
  node.classList.remove("is-visible");
  void node.offsetHeight; // fuerza layout con opacity:0 aplicado
  return twoFrames().then(() => {
    node.classList.add("is-visible");
    return waitOpacityEnd(node);
  });
}

// Reemplaza la pantalla actual llamando a `builder()` para construir la nueva.
// `builder` es una función síncrona que devuelve un HTMLElement listo para
// insertar. Se invoca únicamente cuando el DOM está limpio.
export async function replaceScreen(builder) {
  await acquire();
  try {
    const app = appRoot();
    // Fade-out de todo lo que haya montado como pantalla.
    const previous = Array.from(app.children).filter(
      (n) => n.nodeType === 1
    );
    if (previous.length > 0) {
      await Promise.all(previous.map(fadeOut));
      // Un rAF adicional garantiza que el frame negro llega a pintarse.
      await twoFrames();
      for (const p of previous) p.remove();
    }
    // Construimos la siguiente pantalla ya con el DOM limpio.
    const next = builder();
    if (!next) return null;
    next.classList.add("layer");
    app.appendChild(next);
    await fadeIn(next);
    return next;
  } finally {
    release();
  }
}

// Muestra un overlay temporal (ej. "SECCIÓN COMPLETADA" o "ARCHIVANDO") sobre
// pantalla completamente negra, con fade-in / fade-out limpio. Devuelve una
// promesa que resuelve cuando el overlay ha desaparecido por completo.
//
// `render` recibe el nodo del overlay y puede modificarlo (por ejemplo cambiar
// el texto). Se llama justo tras el fade-in, y su valor de retorno se espera:
//  - Si devuelve un número, se interpreta como los ms extra de espera.
//  - Si devuelve una promesa, se espera a que resuelva.
//  - Si no devuelve nada, se espera `holdMs`.
export async function flashOverlay(text, { holdMs = 350, render } = {}) {
  await acquire();
  try {
    const app = appRoot();
    // Limpia todo — la regla es que no exista otra pantalla mientras el
    // overlay esté en pantalla.
    const previous = Array.from(app.children).filter(
      (n) => n.nodeType === 1
    );
    if (previous.length > 0) {
      await Promise.all(previous.map(fadeOut));
      await twoFrames();
      for (const p of previous) p.remove();
    }

    const overlay = document.createElement("div");
    overlay.className = "layer flash-overlay";
    overlay.textContent = text;
    app.appendChild(overlay);
    await fadeIn(overlay);

    if (typeof render === "function") {
      const result = render(overlay);
      if (typeof result === "number") {
        await new Promise((r) => setTimeout(r, result));
      } else if (result && typeof result.then === "function") {
        await result;
      } else {
        await new Promise((r) => setTimeout(r, holdMs));
      }
    } else {
      await new Promise((r) => setTimeout(r, holdMs));
    }

    await fadeOut(overlay);
    await twoFrames();
    overlay.remove();
  } finally {
    release();
  }
}

// Utilidad: espera "sin hacer nada" mientras el DOM está vacío. Sirve para el
// pequeño silencio entre pantallas cuando lo pide el guion.
export async function blackPause(ms = 200) {
  await acquire();
  try {
    const app = appRoot();
    const previous = Array.from(app.children).filter(
      (n) => n.nodeType === 1
    );
    if (previous.length > 0) {
      await Promise.all(previous.map(fadeOut));
      await twoFrames();
      for (const p of previous) p.remove();
    }
    await new Promise((r) => setTimeout(r, ms));
  } finally {
    release();
  }
}
