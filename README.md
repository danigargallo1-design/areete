# ARETÉ

Registro diario de rendición de cuentas. Reescrito en HTML5, CSS3 y JavaScript ES6 puro — sin frameworks, sin bundlers y sin backend.

## Estructura

```
/
├── index.html          Ritual del día
├── history.html        Historial de días concluidos
├── settings.html       Ajustes y datos
├── manifest.webmanifest
├── sw.js               Service Worker (offline)
├── /styles             globals, cards, animations, typography, layout
├── /js                 app, ui, ritual, storage, history, settings, quotes, utils
├── /data
│   ├── habits.json     Categorías y compromisos por defecto
│   └── /quotes         Un JSON por autor (Marco Aurelio, Séneca…)
└── /assets/logo.svg
```

## Persistencia

Todo se guarda localmente en IndexedDB (`arete`) con seis almacenes que replican el modelo original: `profile`, `categories`, `habits`, `days`, `entries`, `quotes`. La aplicación funciona completamente offline y sobrevive al cierre del navegador. No hay servidor, no hay API, no hay base de datos remota.

Las frases se leen automáticamente al iniciar desde `/data/quotes/index.json`, que enumera los archivos por autor.

## Desarrollo

Abrir `index.html` con la extensión **Live Server** de VS Code. No requiere instalación, compilación ni dependencias.

## Despliegue

Se despliega en Vercel como sitio estático — subir la carpeta tal cual. La PWA queda instalable en Android e iOS desde `Añadir a pantalla de inicio`.
