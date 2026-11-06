import { auth, db, PUSH_CONFIG } from "./firebase-config.js";
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
let rewardRequestsUnsubscribe = null;
let userDirectory = new Map();
let taskRecords = [];
let notificationRecords = [];
let storyRecords = [];
let notificationsInitialized = false;
let editingTaskId = null;
let rewardRequestRecords = [];

export function renderAdminPanel(ui) {
  if (usersUnsubscribe) usersUnsubscribe();
  if (tasksUnsubscribe) tasksUnsubscribe();
  if (notificationsUnsubscribe) notificationsUnsubscribe();
  if (storiesUnsubscribe) storiesUnsubscribe();
  if (rewardRequestsUnsubscribe) rewardRequestsUnsubscribe();

  ui.showSection("admin-panel");
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
  const rewardRequestsContainer = ui.getElement("admin-reward-requests");
  const rewardRequestCount = ui.getElement("admin-reward-request-count");
  userDirectory = new Map();
  taskRecords = [];
  notificationRecords = [];
  storyRecords = [];
  rewardRequestRecords = [];
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
        if (data.role === "girlfriend") {
          const points = document.createElement("p");
          points.className = "mt-1 text-xs text-pink-300";
          points.textContent = `Love Bank · ${Number(data.rewardPoints) || 0} pts`;
          accountDetails.appendChild(points);
        }
        if (isAdmin) {
          const adminBadge = document.createElement("span");
          adminBadge.className = "inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold bg-pink-600 text-white";
          adminBadge.textContent = "ADMIN";
          accountDetails.appendChild(adminBadge);
        }
        card.prepend(accountDetails);
        if (!isAdmin && data.role === "girlfriend") {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "shrink-0 rounded-lg border border-red-800 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/60 disabled:cursor-wait disabled:opacity-60";
          deleteButton.textContent = "Delete account";
          deleteButton.setAttribute("aria-label", `Permanently delete ${data.username || "girlfriend"}'s account`);
          deleteButton.addEventListener("click", () => deleteGirlfriendAccount(id, data.username, deleteButton));
          card.appendChild(deleteButton);
        }
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
      const errorMessage = err.code === "permission-denied"
        ? "Access denied. Confirm that you are signed in with the admin account and that the latest Firestore rules are published."
        : `Failed to load accounts (${err.code || "unknown"}).`;
      const error = document.createElement("p");
      error.className = "text-red-400 text-sm";
      error.textContent = errorMessage;
      usersContainer.replaceChildren(error);
      userSelect.innerHTML = '<option value="">Accounts unavailable</option>';
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
        completionNotice.textContent = `${girlfriend?.username || "A partner"} submitted: ${notification.taskTitle || "a task"}`;
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

  rewardRequestsUnsubscribe = onSnapshot(
    collection(db, "rewardRequests"),
    (snap) => {
      rewardRequestRecords = snap.docs.map((requestSnap) => ({
        id: requestSnap.id,
        ...requestSnap.data()
      }));
      rewardRequestRecords.sort((a, b) => timestampValue(b.requestedAt) - timestampValue(a.requestedAt));
      renderRewardRequests(rewardRequestsContainer, rewardRequestCount);
    },
    (err) => {
      rewardRequestsContainer.innerHTML = '<p class="text-red-400 text-sm">Failed to load reward requests.</p>';
      rewardRequestCount.textContent = "Unavailable";
      console.error("Failed to load reward requests:", err);
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

  taskForm.onsubmit = async (e) => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    const assignedTo = userSelect.value;
    const points = Number(ui.getElement("task-points").value);
    if (!title || !assignedTo || !Number.isSafeInteger(points) || points < 0 || points > 100000) {
      alert("Enter a task title, choose a partner, and set points from 0 to 100,000.");
      return;
    }
    const submitButton = taskForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await addDoc(collection(db, "tasks"), {
        title,
        description: ui.getElement("task-description").value.trim(),
        category: ui.getElement("task-category").value,
        priority: ui.getElement("task-priority").value,
        points,
        dueDate: ui.getElement("task-due-date").value || null,
        assignedTo,
        status: "pending",
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      taskTitleInput.value = "";
      ui.getElement("task-description").value = "";
      ui.getElement("task-due-date").value = "";
    } catch (err) {
      alert("Failed to create task: " + err.message);
      console.error(err);
    } finally {
      submitButton.disabled = false;
    }
  };

}

export function destroyAdmin() {
  if (usersUnsubscribe) usersUnsubscribe();
  if (tasksUnsubscribe) tasksUnsubscribe();
  if (notificationsUnsubscribe) notificationsUnsubscribe();
  if (storiesUnsubscribe) storiesUnsubscribe();
  if (rewardRequestsUnsubscribe) rewardRequestsUnsubscribe();
  usersUnsubscribe = null;
  tasksUnsubscribe = null;
  notificationsUnsubscribe = null;
  storiesUnsubscribe = null;
  rewardRequestsUnsubscribe = null;
  notificationsInitialized = false;
  editingTaskId = null;
  rewardRequestRecords = [];
}

function renderRewardRequests(container, count) {
  const pendingCount = rewardRequestRecords.filter((request) => request.status === "pending").length;
  count.textContent = `${pendingCount} pending`;
  container.replaceChildren();
  if (!rewardRequestRecords.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm">No reward requests yet.</p>';
    return;
  }
  rewardRequestRecords.forEach((request) => {
    const item = document.createElement("article");
    item.className = "border-b border-slate-800 py-3 last:border-0";
    const title = document.createElement("p");
    title.className = "font-medium text-slate-200";
    title.textContent = `${request.partnerName || "Partner"} · ${request.rewardTitle || "Reward"}`;
    const metadata = document.createElement("p");
    metadata.className = "mt-1 text-xs text-slate-500";
    metadata.textContent = `${Number(request.cost) || 0} pts · ${request.status || "pending"} · ${timestampLabel(request.requestedAt)}`;
    item.append(title, metadata);
    if (request.reviewNote) {
      const note = document.createElement("p");
      note.className = "mt-2 text-sm text-pink-200";
      note.textContent = `Your note: ${request.reviewNote}`;
      item.appendChild(note);
    }
    if (request.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "mt-3 flex gap-3";
      ["approved", "rejected"].forEach((decision) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = decision === "approved"
          ? "text-xs font-semibold text-green-400 hover:text-green-300 disabled:opacity-50"
          : "text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50";
        button.textContent = decision === "approved" ? "Approve request" : "Decline & refund";
        button.onclick = () => reviewRewardRequest(request, decision, button);
        actions.appendChild(button);
      });
      item.appendChild(actions);
    }
    container.appendChild(item);
  });
}

async function reviewRewardRequest(request, decision, button) {
  const note = window.prompt(
    decision === "rejected" ? "Why is this request being declined?" : "Optional note for this request:",
    ""
  );
  if (note === null) return;
  if (note.trim().length > 2000) {
    window.alert("The review note must be 2,000 characters or fewer.");
    return;
  }
  const admin = auth.currentUser;
  if (!admin || admin.uid !== ADMIN_UID) {
    window.alert("You must be signed in as the admin to review reward requests.");
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(PUSH_CONFIG.workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await admin.getIdToken()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "reviewReward", requestId: request.id, decision, note })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Reward review failed (HTTP ${response.status}).`);
    window.alert(decision === "rejected"
      ? `Request declined. ${result.refunded} points were refunded.`
      : "Reward request approved.");
  } catch (error) {
    console.error("Failed to review reward request:", error);
    window.alert(`Could not review this request. ${error.message}`);
    button.disabled = false;
  }
}

function renderTaskList(container, summary) {
  if (!taskRecords.length) {
    container.innerHTML = '<p class="text-slate-500 text-sm">No tasks assigned yet.</p>';
    summary.textContent = "0 tasks";
    return;
  }

  const completedCount = taskRecords.filter((task) => ["done", "approved"].includes(task.status)).length;
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
    if (["done", "submitted", "rejected"].includes(task.status)) {
      const noteLabel = document.createElement("p");
      noteLabel.className = "mt-3 text-xs font-semibold uppercase tracking-wide text-pink-300";
      noteLabel.textContent = task.status === "rejected" ? "Latest submission" : "Partner's completion note";
      const completionNote = document.createElement("p");
      completionNote.className = "mt-1 whitespace-pre-wrap break-words text-sm text-slate-300";
      completionNote.textContent = task.completionNote || "No completion note was submitted.";
      details.append(noteLabel, completionNote);
    }
    if (task.description) {
      const description = document.createElement("p");
      description.className = "mt-2 text-sm text-slate-400 whitespace-pre-wrap break-words";
      description.textContent = task.description;
      details.appendChild(description);
    }
    const taskMeta = document.createElement("p");
    taskMeta.className = "mt-2 text-xs text-slate-500";
    taskMeta.textContent = [
      task.category || "task",
      task.priority || "",
      `${Number(task.points) || 0} pts`,
      task.dueDate ? `Due ${task.dueDate}` : ""
    ].filter(Boolean).join(" · ");
    details.appendChild(taskMeta);
    if (task.adminFeedback) {
      const feedback = document.createElement("p");
      feedback.className = "mt-2 text-sm text-pink-200";
      feedback.textContent = `Admin feedback: ${task.adminFeedback}`;
      details.appendChild(feedback);
    }
    const statusBadge = document.createElement("span");
    const isComplete = ["done", "approved"].includes(task.status);
    statusBadge.className = `inline-flex w-fit items-center rounded px-2.5 py-1 text-xs font-semibold ${isComplete ? "bg-green-950 text-green-300" : "bg-slate-800 text-slate-300"}`;
    statusBadge.textContent = task.status === "done" ? "Completed (legacy)" : (task.status || "pending");
    const actions = document.createElement("div");
    actions.className = "flex items-center gap-3 shrink-0";
    if (task.status === "submitted" || task.status === "done") {
      const approveButton = document.createElement("button");
      approveButton.type = "button";
      approveButton.className = "text-xs font-semibold text-green-400 hover:text-green-300 disabled:opacity-50";
      approveButton.textContent = `Approve · +${Number(task.points) || 0} pts`;
      approveButton.onclick = () => reviewTask(task, "approved", approveButton);
      const rejectButton = document.createElement("button");
      rejectButton.type = "button";
      rejectButton.className = "text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50";
      rejectButton.textContent = "Request revision";
      rejectButton.onclick = () => reviewTask(task, "rejected", rejectButton);
      actions.append(approveButton, rejectButton);
    }
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
      const prompt = ["done", "submitted", "approved"].includes(task.status)
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

async function reviewTask(task, decision, button) {
  const feedback = decision === "rejected"
    ? window.prompt("Share a helpful note so the partner knows what to update:", task.adminFeedback || "")
    : window.prompt("Optional feedback for this task:", task.adminFeedback || "");
  if (feedback === null) return;
  if (feedback.trim().length > 2000) {
    window.alert("Feedback must be 2,000 characters or fewer.");
    return;
  }
  const admin = auth.currentUser;
  if (!admin || admin.uid !== ADMIN_UID) {
    window.alert("You must be signed in as the admin to review tasks.");
    return;
  }
  if (!PUSH_CONFIG.workerUrl || PUSH_CONFIG.workerUrl.startsWith("SET_")) {
    window.alert("Task review is unavailable until the Cloudflare Worker is configured.");
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(PUSH_CONFIG.workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await admin.getIdToken()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "reviewTask", taskId: task.id, decision, feedback })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Task review failed (HTTP ${response.status}).`);
    window.alert(decision === "approved"
      ? `Task approved. ${result.pointsAwarded} Love Bank points awarded.`
      : "Task returned for revision.");
  } catch (error) {
    console.error("Failed to review task:", error);
    window.alert(`Could not review this task. ${error.message}`);
    button.disabled = false;
  }
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
    if (typeof story.imageUrl === "string" && story.imageUrl.startsWith("https://")) {
      const image = document.createElement("img");
      image.src = story.imageUrl;
      image.alt = `Photo shared by ${story.authorName || "Partner"}`;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.className = "mb-3 max-h-80 w-full rounded-xl object-cover";
      image.onerror = () => image.remove();
      item.appendChild(image);
    }
    const content = document.createElement("p");
    content.className = "text-sm text-slate-200 whitespace-pre-wrap break-words";
    content.textContent = story.content || "";
    const byline = document.createElement("p");
    byline.className = "mt-2 text-xs text-slate-500";
    byline.textContent = [
      story.authorName || "Partner",
      story.location || "",
      timestampLabel(story.createdAt)
    ].filter(Boolean).join(" · ");
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
    container.innerHTML = '<p class="text-slate-500 text-sm">No task submissions yet.</p>';
    return;
  }

  notificationRecords.forEach((notification) => {
    const girlfriend = userDirectory.get(notification.assignedTo);
    const item = document.createElement("div");
    item.className = `border-b border-slate-800 py-2 last:border-0 ${notification.read ? "opacity-70" : ""}`;
    const message = document.createElement("p");
    message.className = "text-sm text-slate-200";
    message.textContent = `${girlfriend?.username || "A girlfriend"} submitted ${notification.taskTitle || "a task"} for review`;
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

async function deleteGirlfriendAccount(userId, username, button) {
  const accountName = username || "this girlfriend";
  const confirmation = window.prompt(
    `Permanently delete ${accountName}'s account and related data? This cannot be undone.\nType ${accountName} to confirm:`
  );
  if (confirmation !== accountName) return;

  const admin = auth.currentUser;
  if (!admin || admin.uid !== ADMIN_UID) {
    window.alert("You must be signed in as the admin to delete an account.");
    return;
  }
  if (!PUSH_CONFIG.workerUrl || PUSH_CONFIG.workerUrl.startsWith("SET_")) {
    window.alert("Account deletion is unavailable until the Cloudflare Worker is configured.");
    return;
  }

  button.disabled = true;
  button.textContent = "Deleting...";
  try {
    const response = await fetch(PUSH_CONFIG.workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await admin.getIdToken()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "deleteAccount", userId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Account deletion failed (HTTP ${response.status}).`);
    }
    window.alert(`${accountName}'s account was permanently deleted.`);
  } catch (error) {
    console.error("Failed to delete girlfriend account:", error);
    window.alert(`Could not delete ${accountName}'s account. ${error.message}`);
    button.disabled = false;
    button.textContent = "Delete account";
  }
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
