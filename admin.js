import { auth, db } from "./firebase-config.js";
import { ADMIN_UID } from "./auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

let usersUnsubscribe = null;
let tasksUnsubscribe = null;
let notificationsUnsubscribe = null;
let storiesUnsubscribe = null;
let userDirectory = new Map();
let taskRecords = [];
let notificationRecords = [];
let storyRecords = [];
let notificationsInitialized = false;
let editingTaskId = null;

export function initAdmin(ui) {
  if (auth.currentUser && auth.currentUser.uid !== ADMIN_UID) return;
  renderAdminPanel(ui);
}

export function renderAdminPanel(ui) {
  if (usersUnsubscribe) usersUnsubscribe();
  if (tasksUnsubscribe) tasksUnsubscribe();
  if (notificationsUnsubscribe) notificationsUnsubscribe();
  if (storiesUnsubscribe) storiesUnsubscribe();

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
  const storiesContainer = ui.getElement("admin-stories-list");
  const storiesCount = ui.getElement("admin-stories-count");
  userDirectory = new Map();
  taskRecords = [];
  notificationRecords = [];
  storyRecords = [];
  notificationsInitialized = false;
  editingTaskId = null;

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
        card.className = "bg-slate-900 border border-slate-700 rounded-lg p-4 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3";
        const accountDetails = document.createElement("div");
        accountDetails.className = "min-w-0";
        const username = document.createElement("p");
        username.className = "font-semibold text-slate-200 break-words";
        username.textContent = data.username || "Unnamed account";
        const email = document.createElement("p");
        email.className = "text-xs text-slate-500 mt-1 break-all";
        email.textContent = data.email || "";
        accountDetails.append(username, email);
        if (isAdmin) {
          const adminBadge = document.createElement("span");
          adminBadge.className = "inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold bg-pink-600 text-white";
          adminBadge.textContent = "ADMIN";
          accountDetails.appendChild(adminBadge);
        }
        card.prepend(accountDetails);
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

  storiesUnsubscribe = onSnapshot(
    collection(db, "stories"),
    (snap) => {
      storyRecords = snap.docs.map((storySnap) => ({
        id: storySnap.id,
        ...storySnap.data()
      }));
      storyRecords.sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
      renderStories(storiesContainer, storiesCount);
    },
    (err) => {
      storiesContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load stories.</p>';
      storiesCount.textContent = "Unavailable";
      console.error("Failed to load stories:", err);
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
  if (storiesUnsubscribe) storiesUnsubscribe();
  usersUnsubscribe = null;
  tasksUnsubscribe = null;
  notificationsUnsubscribe = null;
  storiesUnsubscribe = null;
  notificationsInitialized = false;
  editingTaskId = null;
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
    row.className = "border-b border-slate-800 py-3 last:border-0";
    if (editingTaskId === task.id) {
      renderTaskEditor(row, task);
      container.appendChild(row);
      return;
    }

    const rowContent = document.createElement("div");
    rowContent.className = "flex flex-col sm:flex-row sm:items-center justify-between gap-3";
    const details = document.createElement("div");
    details.className = "min-w-0";
    const title = document.createElement("p");
    title.className = "font-medium text-slate-200 break-words";
    title.textContent = task.title || "Untitled task";
    const assigneeText = document.createElement("p");
    assigneeText.className = "text-xs text-slate-500 mt-1";
    assigneeText.textContent = `Assigned to ${assignee?.username || "Unknown account"}`;
    details.append(title, assigneeText);
    if (task.status === "done") {
      const noteLabel = document.createElement("p");
      noteLabel.className = "mt-3 text-xs font-semibold uppercase tracking-wide text-pink-300";
      noteLabel.textContent = "Girlfriend's completion note";
      const completionNote = document.createElement("p");
      completionNote.className = "mt-1 whitespace-pre-wrap break-words text-sm text-slate-300";
      completionNote.textContent = task.completionNote || "No completion note was submitted.";
      details.append(noteLabel, completionNote);
    }
    const statusBadge = document.createElement("span");
    statusBadge.className = `inline-flex w-fit items-center rounded px-2.5 py-1 text-xs font-semibold ${task.status === "done" ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-300"}`;
    statusBadge.textContent = task.status || "pending";
    const actions = document.createElement("div");
    actions.className = "flex items-center gap-3 shrink-0";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "text-xs font-medium text-pink-400 hover:text-pink-300";
    editButton.textContent = "Edit";
    editButton.onclick = () => {
      editingTaskId = task.id;
      renderTaskList(container, summary);
    };
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "text-xs font-medium text-red-400 hover:text-red-300";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete task ${task.title || "Untitled task"}`);
    deleteButton.onclick = async () => {
      const prompt = task.status === "done"
        ? "Delete this completed task and its completion alerts?"
        : "Delete this task?";
      if (!window.confirm(prompt)) return;
      deleteButton.disabled = true;
      try {
        await deleteTaskAndNotifications(task.id);
      } catch (error) {
        deleteButton.disabled = false;
        alert("Could not delete task: " + error.message);
        console.error(error);
      }
    };
    actions.append(editButton, deleteButton);
    rowContent.append(details, statusBadge, actions);
    row.appendChild(rowContent);
    container.appendChild(row);
  });
}

function renderTaskEditor(row, task) {
  const form = document.createElement("form");
  form.className = "grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] gap-2 items-end";

  const titleLabel = document.createElement("label");
  titleLabel.className = "block text-xs text-slate-400";
  titleLabel.textContent = "Task title";
  const titleInput = document.createElement("input");
  titleInput.required = true;
  titleInput.maxLength = 160;
  titleInput.value = task.title || "";
  titleInput.className = "mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500";
  titleLabel.appendChild(titleInput);

  const assigneeLabel = document.createElement("label");
  assigneeLabel.className = "block text-xs text-slate-400";
  assigneeLabel.textContent = "Assigned to";
  const assigneeSelect = document.createElement("select");
  assigneeSelect.className = "mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500";
  userDirectory.forEach((user, uid) => {
    if (uid === ADMIN_UID) return;
    const option = document.createElement("option");
    option.value = uid;
    option.textContent = user.username || "Unnamed account";
    assigneeSelect.appendChild(option);
  });
  if (task.assignedTo && !userDirectory.has(task.assignedTo)) {
    const option = document.createElement("option");
    option.value = task.assignedTo;
    option.textContent = "Current assignee";
    assigneeSelect.appendChild(option);
  }
  assigneeSelect.value = task.assignedTo || "";
  assigneeLabel.appendChild(assigneeSelect);

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-3 pb-1";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "text-xs font-semibold text-pink-400 hover:text-pink-300";
  saveButton.textContent = "Save";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "text-xs text-slate-400 hover:text-white";
  cancelButton.textContent = "Cancel";
  cancelButton.onclick = () => {
    editingTaskId = null;
    renderTaskList(row.parentElement, document.getElementById("admin-task-summary"));
  };
  actions.append(saveButton, cancelButton);
  form.append(titleLabel, assigneeLabel, actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const assignedTo = assigneeSelect.value;
    if (!title || !assignedTo) return;
    saveButton.disabled = true;
    try {
      await updateDoc(doc(db, "tasks", task.id), {
        title,
        assignedTo,
        updatedAt: serverTimestamp()
      });
      editingTaskId = null;
    } catch (error) {
      saveButton.disabled = false;
      alert("Could not update task: " + error.message);
      console.error(error);
    }
  };
  row.appendChild(form);
}

async function deleteTaskAndNotifications(taskId) {
  const notifications = await getDocs(query(
    collection(db, "notifications"),
    where("taskId", "==", taskId)
  ));
  const notificationDocs = notifications.docs;
  for (let offset = 0; offset < notificationDocs.length; offset += 450) {
    const batch = writeBatch(db);
    notificationDocs.slice(offset, offset + 450).forEach((notification) => {
      batch.delete(notification.ref);
    });
    await batch.commit();
  }
  await deleteDoc(doc(db, "tasks", taskId));
}

function renderStories(container, count) {
  count.textContent = `${storyRecords.length} ${storyRecords.length === 1 ? "story" : "stories"}`;
  container.innerHTML = "";
  if (!storyRecords.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm">No stories shared yet.</p>';
    return;
  }

  storyRecords.forEach((story) => {
    const item = document.createElement("article");
    item.className = "border-b border-slate-800 py-3 last:border-0";
    const content = document.createElement("p");
    content.className = "text-sm text-slate-200 whitespace-pre-wrap break-words";
    content.textContent = story.content || "";
    const byline = document.createElement("p");
    byline.className = "mt-2 text-xs text-slate-500";
    byline.textContent = `${story.authorName || "Girlfriend"} · ${timestampLabel(story.createdAt)}`;
    item.append(content, byline);
    container.appendChild(item);
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
    if (notification.completionNote) {
      const completionNote = document.createElement("p");
      completionNote.className = "mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-950/60 p-3 text-sm text-slate-300";
      completionNote.textContent = notification.completionNote;
      item.appendChild(completionNote);
    }
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
