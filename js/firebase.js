import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getMessaging,
  getToken
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyBf4PyrvhPRpN9QvNQQT68-pzLZtjdcs_g",
  authDomain: "arete-9f4d8.firebaseapp.com",
  projectId: "arete-9f4d8",
  storageBucket: "arete-9f4d8.firebasestorage.app",
  messagingSenderId: "492601426608",
  appId: "1:492601426608:web:ddc908c39f684f09623175",
  measurementId: "G-DQ1TTWK7FG"
};

const app = initializeApp(firebaseConfig);

const messaging = getMessaging(app);

export async function initNotifications() {
  try {
    if (!("serviceWorker" in navigator)) {
      console.error("Este navegador no soporta Service Workers.");
      return;
    }

    // Registrar (o reutilizar) tu sw.js
    const registration = await navigator.serviceWorker.register("./sw.js");

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      console.log("❌ Permiso denegado");
      return;
    }

    const token = await getToken(messaging, {
      vapidKey: "BJSGbE1IU0-6f-aMoURO_CUu9G8wSuinOGJzeXM3VF5tmnInmzt4TT1m6uQnz5WnqeKxw-fUoa-NSiTDbPfiz4w",
      serviceWorkerRegistration: registration
    });

    console.log("✅ Token FCM:");
    console.log(token);

  } catch (err) {
    console.error("🔥 Error Firebase:", err);
  }
}