import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyBf4PyrvhPRpN9QvNQQT68-pzLZtjdcs_g",
  authDomain: "arete-9f4d8.firebaseapp.com",
  projectId: "arete-9f4d8",
  storageBucket: "arete-9f4d8.firebasestorage.app",
  messagingSenderId: "492601426608",
  appId: "1:492601426608:web:ddc908c39f684f09623175",
  measurementId: "G-DQ1TTWK7FG"
};

export const app = initializeApp(firebaseConfig);

console.log("Firebase conectado.");