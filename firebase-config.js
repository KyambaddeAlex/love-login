import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCmSct3OAz6k6YwVpt6TQxqOJPQfxwVJm8",
  authDomain: "love-login-fc11d.firebaseapp.com",
  projectId: "love-login-fc11d",
  storageBucket: "love-login-fc11d.firebasestorage.app",
  messagingSenderId: "962018867320",
  appId: "1:962018867320:web:ecffa5b52e2d8420c1d58d",
  measurementId: "G-LBE9BJBJW6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const PUSH_CONFIG = {
  vapidKey: "BBGcls99PanykGxAW6Qrs1D2u3gSIIReAUNhMTkIvhOOcu94L4vhkJc_xIgW-vKlvI9XiVsb89DlVq0LVRRJ4HE",
  workerUrl: "https://love-login-push.kyambaddealex55.workers.dev"
};
