import { auth, db } from "./firebase-config.js";
import { ADMIN_UID } from "./auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  query,
  orderBy,
  limit,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

let usersUnsubscribe = null;
let tasksUnsubscribe = null;
let notificationsUnsubscribe = null;
let userDirectory = new Map();
let taskRecords = [];
let notificationRecords = [];
let notificationsInitialized = false;

export function initAdmin(ui) {
  if (auth.currentUser && auth.currentUser.uid !== ADMIN_UID) return;
  renderAdminPanel(ui);
}

export function renderAdminPanel(ui) {
  if (usersUnsubscribe) usersUnsubscribe();
  if (tasksUnsubscribe) tasksUnsubscribe();
  if (notificationsUnsubscribe) notificationsUnsubscribe();

  ui.showSection("admin-panel");
  ui.hideSection("user-dashboard");
  ui.hideSection("auth-view");

  const usersContainer = ui.getElement("admin-users-list");
  const userSelect = ui.getElement("assign-user-select");
  const taskForm = ui.getElement("task-form");
  const taskTitleInput = ui.getElement("task-title");
  const tasksContainer = ui.getElement("admin-tasks-list");
  const taskSummary = ui.getElement("admin-task-summary");
  const notificationsContainer = ui.getElement("admin-notifications-list");
  const notificationCount = ui.getElement("admin-notification-count");
  const completionNotice = ui.getElement("admin-completion-notice");
  const markNotificationsRead = ui.getElement("admin-mark-notifications-read");
  userDirectory = new Map();
  taskRecords = [];
  notificationRecords = [];
  notificationsInitialized = false;

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
      userDirectory = new Map(users.map(({ id, data }) => [id, data]));
      renderNotifications(notificationsContainer, notificationCount, markNotificationsRead);
      users.sort((a, b) => {
        const da = a.data.createdAt ? new Date(a.data.createdAt).getTime() : 0;
        const db_ = b.data.createdAt ? new Date(b.data.createdAt).getTime() : 0;
        return db_ - da;
      });

      users.forEach(({ id, data }) => {
        const isAdmin = id === ADMIN_UID;

        const card = document.createElement("div");
        card.className = "bg-slate-900 border border-slate-700 rounded-lg p-4 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2";
        card.innerHTML = `
          <div class="flex flex-col sm:flex-row items-center gap-2">
            <span class="font-semibold text-slate-200">${escapeHtml(data.username || "Unnamed account")}</span>
            ${isAdmin ? '<span class="inline-block mt-1 sm:mt-0 px-2 py-0.5 rounded text-[10px] font-bold bg-pink-600 text-white">ADMIN</span>' : ""}
          </div>
        `;
        usersContainer.appendChild(card);

        if (!isAdmin) {
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = data.username || "Unnamed account";
          userSelect.appendChild(opt);
        }
      });

      if (snap.empty) {
        usersContainer.innerHTML = '<p class="text-slate-400 text-sm">No registered accounts found.</p>';
      }
      renderTaskList(tasksContainer, taskSummary);
    },
    (err) => {
      usersContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load accounts.</p>';
      console.error(err);
    }
  );

  tasksUnsubscribe = onSnapshot(
    collection(db, "tasks"),
    (snap) => {
      taskRecords = [];
      snap.forEach((taskSnap) => {
        taskRecords.push({ id: taskSnap.id, ...taskSnap.data() });
      });
      taskRecords.sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
      renderTaskList(tasksContainer, taskSummary);
    },
    (err) => {
      tasksContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load tasks.</p>';
      taskSummary.textContent = "Unavailable";
      console.error("Failed to load admin tasks:", err);
    }
  );

  notificationsUnsubscribe = onSnapshot(
    query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(20)),
    (snap) => {
      notificationRecords = snap.docs.map((notificationSnap) => ({
        id: notificationSnap.id,
        ...notificationSnap.data()
      }));
      const newCompletions = notificationsInitialized
        ? snap.docChanges().filter((change) => change.type === "added" && !change.doc.data().read)
        : [];
      notificationsInitialized = true;
      renderNotifications(notificationsContainer, notificationCount, markNotificationsRead);

      if (newCompletions.length) {
        const notification = newCompletions[newCompletions.length - 1].doc.data();
        const girlfriend = userDirectory.get(notification.assignedTo);
        completionNotice.textContent = `${girlfriend?.username || "A girlfriend"} completed: ${notification.taskTitle || "a task"}`;
        completionNotice.classList.remove("hidden");
      }
    },
    (err) => {
      notificationsContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load notifications.</p>';
      console.error("Failed to load task notifications:", err);
    }
  );

  markNotificationsRead.onclick = async () => {
    const unread = notificationRecords.filter((notification) => !notification.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((notification) => {
      batch.update(doc(db, "notifications", notification.id), {
        read: true,
        readAt: serverTimestamp()
      });
    });
    markNotificationsRead.disabled = true;
    try {
      await batch.commit();
    } catch (err) {
      console.error("Failed to mark notifications as read:", err);
      alert("Failed to update notifications: " + err.message);
    } finally {
      markNotificationsRead.disabled = false;
    }
  };

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
  if (notificationsUnsubscribe) notificationsUnsubscribe();
  usersUnsubscribe = null;
  tasksUnsubscribe = null;
  notificationsUnsubscribe = null;
  notificationsInitialized = false;
}

function renderTaskList(container, summary) {
  if (!taskRecords.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm">No tasks assigned yet.</p>';
    summary.textContent = "0 tasks";
    return;
  }

  const completedCount = taskRecords.filter((task) => task.status === "done").length;
  summary.textContent = `${completedCount} of ${taskRecords.length} complete`;
  container.innerHTML = "";
  taskRecords.forEach((task) => {
    const assignee = userDirectory.get(task.assignedTo);
    const row = document.createElement("div");
    const status = task.status === "done" ? "Done" : "Pending";
    row.className = "flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 py-3 last:border-0";
    const details = document.createElement("div");
    details.className = "min-w-0";
    const title = document.createElement("p");
    title.className = "font-medium text-slate-200 break-words";
    title.textContent = task.title || "Untitled task";
    const assigneeText = document.createElement("p");
    assigneeText.className = "text-xs text-slate-500 mt-1";
    assigneeText.textContent = `Assigned to ${assignee?.username || "Unknown account"}`;
    details.append(title, assigneeText);
    const statusBadge = document.createElement("span");
    statusBadge.className = `inline-flex w-fit items-center rounded px-2.5 py-1 text-xs font-semibold ${task.status === "done" ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-300"}`;
    statusBadge.textContent = status;
    row.append(details, statusBadge);
    container.appendChild(row);
  });
}

function renderNotifications(container, count, markReadButton) {
  const unreadCount = notificationRecords.filter((notification) => !notification.read).length;
  count.textContent = `${unreadCount} new`;
  markReadButton.disabled = unreadCount === 0;
  markReadButton.classList.toggle("opacity-50", unreadCount === 0);
  container.innerHTML = "";
  if (!notificationRecords.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm">No completed tasks yet.</p>';
    return;
  }

  notificationRecords.forEach((notification) => {
    const girlfriend = userDirectory.get(notification.assignedTo);
    const item = document.createElement("div");
    item.className = `border-b border-slate-800 py-2 last:border-0 ${notification.read ? "opacity-70" : ""}`;
    const message = document.createElement("p");
    message.className = "text-sm text-slate-200";
    message.textContent = `${girlfriend?.username || "A girlfriend"} completed ${notification.taskTitle || "a task"}`;
    const meta = document.createElement("p");
    meta.className = "text-xs text-slate-500 mt-1";
    meta.textContent = timestampLabel(notification.createdAt);
    item.append(message, meta);
    container.appendChild(item);
  });
}

function timestampValue(value) {
  if (value?.toMillis) return value.toMillis();
  const parsed = new Date(value || 0).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function timestampLabel(value) {
  if (!value) return "Just now";
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "Just now" : date.toLocaleString();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
