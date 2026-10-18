import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export const ADMIN_EMAIL = "kyambaddealex55@gmail.com";
export const ADMIN_UID = "cRsPXPZrpxQAwAvA7D6Jd9uU9ca2";

export let currentUser = null;
let registrationPromise = null;

export function getRole(uid) {
  return uid === ADMIN_UID ? "admin" : "girlfriend";
}

export function register(email, password, username, age) {
  const operation = createUserWithEmailAndPassword(auth, email, password)
    .then(async (userCredential) => {
      const user = userCredential.user;
      const role = getRole(user.uid);
      const profile = {
        uid: user.uid,
        username: username || email.split("@")[0],
        email: user.email,
        age: age || null,
        role: role,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, "users", user.uid), profile);
      return { user, role };
    });
  registrationPromise = operation;
  return operation.finally(() => {
    if (registrationPromise === operation) registrationPromise = null;
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
      if (registrationPromise) await registrationPromise.catch(() => {});
      currentUser = { uid: user.uid, email: user.email, role: getRole(user.uid) };
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          Object.assign(currentUser, snap.data());
          currentUser.role = getRole(user.uid);
        } else {
          const profile = {
            uid: user.uid,
            username: user.displayName || user.email.split("@")[0],
            email: user.email,
            age: null,
            role: getRole(user.uid),
            createdAt: user.metadata.creationTime || new Date().toISOString()
          };
          await setDoc(doc(db, "users", user.uid), profile, { merge: true });
          Object.assign(currentUser, profile);
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
