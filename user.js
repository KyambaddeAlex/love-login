import { auth, db } from "./firebase-config.js";
import { currentUser } from "./auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

let tasksUnsubscribe = null;

export function initUser(ui) {
  if (!auth.currentUser || auth.currentUser.email === "kyambaddealex55@gmail.com") return;
  renderUserDashboard(ui);
}

export function renderUserDashboard(ui) {
  const user = auth.currentUser;
  const role = user.email === "kyambaddealex55@gmail.com" ? "admin" : "girlfriend";

  ui.showSection("user-dashboard");
  ui.hideSection("admin-panel");
  ui.hideSection("auth-view");

  const welcome = ui.getElement("user-welcome");
  welcome.textContent = `Welcome, ${(currentUser?.username || user.email.split("@")[0])} (${role})`;

  const tasksContainer = ui.getElement("user-tasks-list");
  tasksContainer.innerHTML = '<p class="text-slate-400 text-sm">Loading your tasks...</p>';

  tasksUnsubscribe = onSnapshot(
    query(
      collection(db, "tasks"),
      where("assignedTo", "==", user.uid),
      orderBy("createdAt", "desc")
    ),
    (snap) => {
      tasksContainer.innerHTML = "";
      if (snap.empty) {
        tasksContainer.innerHTML = '<p class="text-slate-400 text-sm">No tasks assigned to you yet.</p>';
        return;
      }
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const done = data.status === "done";

        const el = document.createElement("div");
        el.className = `bg-slate-900 border border-slate-700 rounded-lg p-4 mb-3 flex items-center justify-between ${done ? "bg-slate-800/50" : ""}`;
        el.innerHTML = `
          <div class="flex-1">
            <div class="font-semibold text-slate-200">${escapeHtml(data.title)}</div>
            <div class="text-xs text-slate-500 mt-1">Status: <span class="capitalize ${done ? "text-pink-400" : "text-slate-400"}">${data.status}</span></div>
            <div class="text-xs text-slate-600 mt-1">ID: ${docSnap.id}</div>
          </div>
          <div class="flex gap-2">
            <button data-action="toggle" data-id="${docSnap.id}" data-done="${done}"
              class="px-4 py-2 rounded text-sm font-medium transition ${done ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-pink-600 hover:bg-pink-500 text-white"}">
              ${done ? "Mark Pending" : "Mark Done"}
            </button>
          </div>
        `;
        tasksContainer.appendChild(el);
      });

      tasksContainer.querySelectorAll('button[data-action="toggle"]').forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          const currentlyDone = btn.dataset.done === "true";
          updateDoc(doc(db, "tasks", id), {
            status: currentlyDone ? "pending" : "done",
            updatedAt: serverTimestamp()
          }).catch((err) => {
            alert("Failed to update task: " + err.message);
            console.error(err);
          });
        };
      });
    },
    (err) => {
      tasksContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load tasks.</p>';
      console.error(err);
    }
  );
}

export function destroyUser() {
  if (tasksUnsubscribe) tasksUnsubscribe();
  tasksUnsubscribe = null;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
