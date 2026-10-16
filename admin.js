import { auth, db } from "./firebase-config.js";
import { ADMIN_EMAIL } from "./auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

let usersUnsubscribe = null;
let tasksUnsubscribe = null;

export function initAdmin(ui) {
  if (auth.currentUser && auth.currentUser.email !== ADMIN_EMAIL) return;
  renderAdminPanel(ui);
}

export function renderAdminPanel(ui) {
  ui.showSection("admin-panel");
  ui.hideSection("user-dashboard");
  ui.hideSection("auth-view");

  const usersContainer = ui.getElement("admin-users-list");
  const userSelect = ui.getElement("assign-user-select");
  const taskForm = ui.getElement("task-form");
  const taskTitleInput = ui.getElement("task-title");

  usersContainer.innerHTML = '<p class="text-slate-400 text-sm">Loading registered accounts...</p>';
  userSelect.innerHTML = '<option value="">Loading users...</option>';

  usersUnsubscribe = onSnapshot(
    collection(db, "users"),
    (snap) => {
      usersContainer.innerHTML = "";
      userSelect.innerHTML = '<option value="">Select a user</option>';

      const users = [];
      snap.forEach((docSnap) => {
        users.push({ id: docSnap.id, data: docSnap.data() });
      });
      users.sort((a, b) => {
        const da = a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0;
        const db_ = b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0;
        return db_ - da;
      });

      users.forEach(({ id, data }) => {
        const isAdmin = data.email === ADMIN_EMAIL;

        const card = document.createElement("div");
        card.className = "bg-slate-900 border border-slate-700 rounded-lg p-4 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2";
        card.innerHTML = `
          <div class="flex flex-col sm:flex-row items-center gap-2">
            <span class="font-semibold text-slate-200">${escapeHtml(data.username || "")}</span>
            <span class="text-xs text-slate-500">${escapeHtml(data.email || "")}</span>
            ${isAdmin ? '<span class="inline-block mt-1 sm:mt-0 px-2 py-0.5 rounded text-[10px] font-bold bg-pink-600 text-white">ADMIN</span>' : ""}
          </div>
          <div class="text-xs text-slate-400 mt-2 sm:mt-0">UID: ${id}</div>
        `;
        usersContainer.appendChild(card);

        if (!isAdmin) {
          const opt = document.createElement("option");
          opt.value = docSnap.id;
          opt.textContent = `${data.username || ""} (${data.email || ""})`;
          userSelect.appendChild(opt);
        }
      });

      if (snap.empty) {
        usersContainer.innerHTML = '<p class="text-slate-400 text-sm">No registered accounts found.</p>';
      }
    },
    (err) => {
      usersContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load accounts.</p>';
      console.error(err);
    }
  );

  taskForm.onsubmit = (e) => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    const assignedTo = userSelect.value;
    if (!title || !assignedTo) return;
    addDoc(collection(db, "tasks"), {
      title,
      assignedTo,
      status: "pending",
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }).then(() => {
      taskTitleInput.value = "";
    }).catch((err) => {
      alert("Failed to create task: " + err.message);
      console.error(err);
    });
  };
}

export function destroyAdmin() {
  if (usersUnsubscribe) usersUnsubscribe();
  if (tasksUnsubscribe) tasksUnsubscribe();
  usersUnsubscribe = null;
  tasksUnsubscribe = null;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
