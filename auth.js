import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export const ADMIN_EMAIL = "kyambaddealex55@gmail.com";

export let currentUser = null;

export function getRole(email) {
  return email === ADMIN_EMAIL ? "admin" : "girlfriend";
}

export function register(email, password, username) {
  return createUserWithEmailAndPassword(auth, email, password)
    .then((userCredential) => {
      const user = userCredential.user;
      const role = getRole(email);
      return setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        username: username || email.split("@")[0],
        email: user.email,
        role: role,
        createdAt: new Date().toISOString()
      }).then(() => ({ user, role }));
    });
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function initAuth(onAuthChange) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = { uid: user.uid, email: user.email, role: getRole(user.email) };
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          Object.assign(currentUser, snap.data());
        }
      } catch (e) {
        console.warn("Could not load user profile", e);
      }
      onAuthChange(currentUser);
    } else {
      currentUser = null;
      onAuthChange(null);
    }
  });
}

export { doc, getDoc };
