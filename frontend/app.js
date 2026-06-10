const state = {
  token: localStorage.getItem("student_task_token") || "",
  user: JSON.parse(localStorage.getItem("student_task_user") || "null"),
  tasks: JSON.parse(localStorage.getItem("student_task_tasks") || "[]"),
  categories: JSON.parse(localStorage.getItem("student_task_categories") || "[]"),
  dashboard: JSON.parse(localStorage.getItem("student_task_dashboard") || "null"),
  offlineQueue: JSON.parse(localStorage.getItem("student_task_offline_queue") || "[]"),
  preferences: {
    notifications: false,
    pushSubscribed: false,
    ...JSON.parse(localStorage.getItem("student_task_preferences") || "{}"),
  },
  notifiedReminderIds: JSON.parse(
    localStorage.getItem("student_task_notified_reminders") || "[]",
  ),
  filters: {
    category: "",
    priority: "",
    status: "",
    sort: "due_asc",
  },
};

const elements = {
  authSection: document.getElementById("authSection"),
  dashboardSection: document.getElementById("dashboardSection"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  taskForm: document.getElementById("taskForm"),
  categoryForm: document.getElementById("categoryForm"),
  taskList: document.getElementById("taskList"),
  categoryList: document.getElementById("categoryList"),
  authMessage: document.getElementById("authMessage"),
  taskMessage: document.getElementById("taskMessage"),
  settingsMessage: document.getElementById("settingsMessage"),
  logoutButton: document.getElementById("logoutButton"),
  notificationButton: document.getElementById("notificationButton"),
  installButton: document.getElementById("installButton"),
  notificationPreference: document.getElementById("notificationPreference"),
  pushStatus: document.getElementById("pushStatus"),
  testPushButton: document.getElementById("testPushButton"),
  quickAddButton: document.getElementById("quickAddButton"),
  syncNowButton: document.getElementById("syncNowButton"),
  connectionBadge: document.getElementById("connectionBadge"),
  offlineBanner: document.getElementById("offlineBanner"),
  showLoginTab: document.getElementById("showLoginTab"),
  showRegisterTab: document.getElementById("showRegisterTab"),
  welcomeMessage: document.getElementById("welcomeMessage"),
  todaysTasks: document.getElementById("todaysTasks"),
  upcomingDeadlines: document.getElementById("upcomingDeadlines"),
  overdueCount: document.getElementById("overdueCount"),
  completionRate: document.getElementById("completionRate"),
  accountName: document.getElementById("accountName"),
  accountEmail: document.getElementById("accountEmail"),
  syncStatus: document.getElementById("syncStatus"),
  resetTaskButton: document.getElementById("resetTaskButton"),
  taskId: document.getElementById("taskId"),
  taskTitle: document.getElementById("taskTitle"),
  taskDescription: document.getElementById("taskDescription"),
  taskDueDate: document.getElementById("taskDueDate"),
  taskPriority: document.getElementById("taskPriority"),
  taskStatus: document.getElementById("taskStatus"),
  taskCategory: document.getElementById("taskCategory"),
  taskReminder: document.getElementById("taskReminder"),
  categoryName: document.getElementById("categoryName"),
  filterCategory: document.getElementById("filterCategory"),
  filterPriority: document.getElementById("filterPriority"),
  filterStatus: document.getElementById("filterStatus"),
  sortTasks: document.getElementById("sortTasks"),
  todayList: document.getElementById("todayList"),
  upcomingList: document.getElementById("upcomingList"),
};

const priorityWeight = { high: 3, medium: 2, low: 1 };
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;

function saveCache() {
  localStorage.setItem("student_task_token", state.token);
  localStorage.setItem("student_task_user", JSON.stringify(state.user));
  localStorage.setItem("student_task_tasks", JSON.stringify(state.tasks));
  localStorage.setItem("student_task_categories", JSON.stringify(state.categories));
  localStorage.setItem("student_task_dashboard", JSON.stringify(state.dashboard));
  localStorage.setItem("student_task_offline_queue", JSON.stringify(state.offlineQueue));
  localStorage.setItem("student_task_preferences", JSON.stringify(state.preferences));
  localStorage.setItem(
    "student_task_notified_reminders",
    JSON.stringify(state.notifiedReminderIds),
  );
}

function resetUserScopedState() {
  state.tasks = [];
  state.categories = [];
  state.dashboard = null;
  state.offlineQueue = [];
  state.notifiedReminderIds = [];
}

function clearFieldErrors() {
  document.querySelectorAll(".field-error").forEach((el) => {
    el.textContent = "";
  });
}

function setFieldError(fieldId, message) {
  const errorEl = document.querySelector(`[data-error-for="${fieldId}"]`);
  if (errorEl) {
    errorEl.textContent = message;
  }
}

function showMessage(element, type, message) {
  element.textContent = message;
  element.className = `message ${type}`;
}

function hideMessage(element) {
  element.textContent = "";
  element.className = "message hidden";
}

function normalizeTask(task) {
  return {
    ...task,
    reminders: Array.isArray(task.reminders) ? task.reminders : [],
  };
}

function isTempId(taskId) {
  return String(taskId).startsWith("temp-");
}

function findTaskById(taskId) {
  return state.tasks.find((item) => String(item.id) === String(taskId));
}

function upsertLocalTask(task) {
  const normalized = normalizeTask(task);
  const index = state.tasks.findIndex((item) => String(item.id) === String(normalized.id));
  if (index >= 0) {
    state.tasks[index] = normalized;
  } else {
    state.tasks.push(normalized);
  }
}

function removeLocalTask(taskId) {
  state.tasks = state.tasks.filter((item) => String(item.id) !== String(taskId));
}

function createReminderObjects(taskId, reminders = []) {
  return reminders.map((reminder, index) => ({
    id: reminder.id || `${taskId}-r${index}`,
    task_id: taskId,
    reminder_time: reminder.reminder_time,
  }));
}

function mergeTaskPayloads(basePayload, patchPayload) {
  return {
    ...basePayload,
    ...patchPayload,
    reminders:
      patchPayload.reminders !== undefined ? patchPayload.reminders : basePayload.reminders,
  };
}

function buildDashboardFromTasks(tasks) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const upcomingLimit = new Date(now);
  upcomingLimit.setDate(upcomingLimit.getDate() + 7);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const overdueCount = tasks.filter((task) => {
    const due = new Date(task.due_date);
    return due < now && task.status !== "completed";
  }).length;
  const todaysTasks = tasks.filter((task) => {
    const due = new Date(task.due_date);
    return due >= startOfToday && due < endOfToday;
  }).length;
  const upcomingDeadlines = tasks.filter((task) => {
    const due = new Date(task.due_date);
    return due >= now && due <= upcomingLimit && task.status !== "completed";
  }).length;
  const completionRate = totalTasks ? Number(((completedTasks / totalTasks) * 100).toFixed(2)) : 0;

  return {
    todays_tasks: todaysTasks,
    upcoming_deadlines: upcomingDeadlines,
    overdue_count: overdueCount,
    completion_rate: completionRate,
    total_tasks: totalTasks,
  };
}

function syncDashboardState() {
  state.dashboard = buildDashboardFromTasks(state.tasks);
}

function formatDateTime(value) {
  const date = new Date(value);
  return date.toLocaleString();
}

function formatShortTaskLine(task) {
  return `${task.title} - ${formatDateTime(task.due_date)}`;
}

function humanizeStatus(status) {
  return status.replace(/_/g, " ");
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function toApiDateTime(value) {
  return value ? new Date(value).toISOString() : null;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }
  if (serviceWorkerRegistration) {
    return serviceWorkerRegistration;
  }
  serviceWorkerRegistration = await navigator.serviceWorker.register("/service-worker.js");
  return serviceWorkerRegistration;
}

function updateConnectionUI() {
  const online = navigator.onLine;
  elements.connectionBadge.textContent = online ? "Online" : "Offline";
  elements.connectionBadge.style.background = online ? "#e0e7ff" : "#fef3c7";
  elements.connectionBadge.style.color = online ? "#3730a3" : "#92400e";
  elements.offlineBanner.classList.toggle("hidden", online);
  renderSettings();
}

async function performRequest(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let detail = "Something went wrong.";
    try {
      const data = await response.json();
      if (Array.isArray(data.detail)) {
        detail = data.detail
          .map((item) => item.msg || JSON.stringify(item))
          .join(", ");
      } else if (typeof data.detail === "string") {
        detail = data.detail;
      } else if (data.detail) {
        detail = JSON.stringify(data.detail);
      }
    } catch (error) {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function queueTaskAction(action) {
  const taskId = String(action.taskId);

  if (action.type === "create") {
    state.offlineQueue = state.offlineQueue.filter((item) => String(item.taskId) !== taskId);
    state.offlineQueue.push(action);
    saveCache();
    renderSettings();
    return;
  }

  if (action.type === "update") {
    const createAction = state.offlineQueue.find(
      (item) => item.type === "create" && String(item.taskId) === taskId,
    );
    if (createAction) {
      createAction.payload = mergeTaskPayloads(createAction.payload, action.payload);
      saveCache();
      renderSettings();
      return;
    }

    const updateAction = state.offlineQueue.find(
      (item) => item.type === "update" && String(item.taskId) === taskId,
    );
    if (updateAction) {
      updateAction.payload = mergeTaskPayloads(updateAction.payload, action.payload);
      saveCache();
      renderSettings();
      return;
    }

    const deleteExists = state.offlineQueue.some(
      (item) => item.type === "delete" && String(item.taskId) === taskId,
    );
    if (!deleteExists) {
      state.offlineQueue.push(action);
    }
    saveCache();
    renderSettings();
    return;
  }

  if (action.type === "delete") {
    const hadPendingCreate = state.offlineQueue.some(
      (item) => item.type === "create" && String(item.taskId) === taskId,
    );
    state.offlineQueue = state.offlineQueue.filter((item) => String(item.taskId) !== taskId);
    if (!hadPendingCreate) {
      state.offlineQueue.push(action);
    }
    saveCache();
    renderSettings();
  }
}

function applyOfflineTaskChange() {
  syncDashboardState();
  saveCache();
  renderAll();
}

function handleOfflineTaskAction(path, method, payload = null) {
  if (method === "POST") {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const offlineTask = normalizeTask({
      id: tempId,
      user_id: state.user?.id || null,
      category_id: payload.category_id,
      title: payload.title,
      description: payload.description,
      due_date: payload.due_date,
      priority: payload.priority,
      status: payload.status,
      reminders: createReminderObjects(tempId, payload.reminders),
      syncPending: true,
    });
    upsertLocalTask(offlineTask);
    queueTaskAction({ type: "create", taskId: tempId, payload });
    applyOfflineTaskChange();
    return offlineTask;
  }

  const taskId = path.split("/").pop();
  const existingTask = findTaskById(taskId);
  if (!existingTask) {
    throw new Error("Task not found in offline cache.");
  }

  if (method === "PUT") {
    const updatedTask = normalizeTask({
      ...existingTask,
      ...payload,
      reminders:
        payload.reminders !== undefined
          ? createReminderObjects(taskId, payload.reminders)
          : existingTask.reminders,
      syncPending: true,
    });
    upsertLocalTask(updatedTask);
    queueTaskAction({ type: "update", taskId, payload });
    applyOfflineTaskChange();
    return updatedTask;
  }

  if (method === "DELETE") {
    removeLocalTask(taskId);
    queueTaskAction({ type: "delete", taskId });
    applyOfflineTaskChange();
    return null;
  }

  throw new Error("Unsupported offline action.");
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isQueueableTaskAction =
    path.startsWith("/api/tasks") && ["POST", "PUT", "DELETE"].includes(method);

  if (!navigator.onLine) {
    if (isQueueableTaskAction) {
      const payload = options.body ? JSON.parse(options.body) : null;
      return handleOfflineTaskAction(path, method, payload);
    }
    throw new Error("You are offline. This action requires an internet connection.");
  }

  return performRequest(path, options);
}

function validateTaskForm() {
  clearFieldErrors();
  let valid = true;

  if (!elements.taskTitle.value.trim()) {
    setFieldError("taskTitle", "Task title is required.");
    valid = false;
  }

  if (!elements.taskDueDate.value) {
    setFieldError("taskDueDate", "Due date is required.");
    valid = false;
  }

  if (elements.taskReminder.value && elements.taskDueDate.value) {
    const reminder = new Date(elements.taskReminder.value);
    const dueDate = new Date(elements.taskDueDate.value);
    if (reminder > dueDate) {
      setFieldError("taskReminder", "Reminder must be before the due date.");
      valid = false;
    }
  }

  return valid;
}

function renderDashboard() {
  const dashboard = buildDashboardFromTasks(state.tasks);
  state.dashboard = dashboard;
  elements.todaysTasks.textContent = dashboard.todays_tasks;
  elements.upcomingDeadlines.textContent = dashboard.upcoming_deadlines;
  elements.overdueCount.textContent = dashboard.overdue_count;
  elements.completionRate.textContent = `${dashboard.completion_rate}%`;
}

function renderCategories() {
  elements.taskCategory.innerHTML = `<option value="">No module selected</option>`;
  elements.filterCategory.innerHTML = `<option value="">All modules</option>`;
  elements.categoryList.innerHTML = "";

  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.category_name;
    elements.taskCategory.appendChild(option);

    const filterOption = document.createElement("option");
    filterOption.value = category.id;
    filterOption.textContent = category.category_name;
    elements.filterCategory.appendChild(filterOption);

    const li = document.createElement("li");
    li.innerHTML = `
      <span>${category.category_name}</span>
      <button type="button" data-delete-category="${category.id}">x</button>
    `;
    elements.categoryList.appendChild(li);
  });

  elements.filterCategory.value = state.filters.category;
}

function getFilteredTasks() {
  const filteredTasks = state.tasks.filter((task) => {
    if (state.filters.category && String(task.category_id || "") !== state.filters.category) {
      return false;
    }
    if (state.filters.priority && task.priority !== state.filters.priority) {
      return false;
    }
    if (state.filters.status && task.status !== state.filters.status) {
      return false;
    }
    return true;
  });

  return filteredTasks.sort((left, right) => {
    if (state.filters.sort === "due_desc") {
      return new Date(right.due_date) - new Date(left.due_date);
    }
    if (state.filters.sort === "priority_desc") {
      return priorityWeight[right.priority] - priorityWeight[left.priority];
    }
    if (state.filters.sort === "priority_asc") {
      return priorityWeight[left.priority] - priorityWeight[right.priority];
    }
    if (state.filters.sort === "title_asc") {
      return left.title.localeCompare(right.title);
    }
    return new Date(left.due_date) - new Date(right.due_date);
  });
}

function renderFocusLists() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const byDueDate = (left, right) => new Date(left.due_date) - new Date(right.due_date);
  const todaysTasks = state.tasks
    .filter((task) => {
      const due = new Date(task.due_date);
      return due >= startOfToday && due < endOfToday;
    })
    .sort(byDueDate);

  const upcomingTasks = state.tasks
    .filter((task) => {
      const due = new Date(task.due_date);
      return due >= now && due <= nextWeek && task.status !== "completed";
    })
    .sort(byDueDate);

  elements.todayList.innerHTML = todaysTasks.length
    ? todaysTasks.slice(0, 5).map((task) => `<li>${formatShortTaskLine(task)}</li>`).join("")
    : "<li>No tasks due today.</li>";

  elements.upcomingList.innerHTML = upcomingTasks.length
    ? upcomingTasks.slice(0, 5).map((task) => `<li>${formatShortTaskLine(task)}</li>`).join("")
    : "<li>No upcoming deadlines in the next 7 days.</li>";
}

function buildTaskCard(task) {
  const category = state.categories.find((item) => item.id === task.category_id);
  const reminder =
    task.reminders && task.reminders.length ? formatDateTime(task.reminders[0].reminder_time) : "None";
  return `
    <article class="task-card">
      <h3>${task.title}</h3>
      <p>${task.description || "No description provided."}</p>
      <div class="task-meta">
        <span class="pill priority-${task.priority}">${task.priority}</span>
        <span class="pill">${humanizeStatus(task.status)}</span>
        <span class="pill">${category ? category.category_name : "Uncategorized"}</span>
        <span class="pill">Due: ${formatDateTime(task.due_date)}</span>
        <span class="pill">Reminder: ${reminder}</span>
        ${task.syncPending ? '<span class="pill">Pending Sync</span>' : ""}
      </div>
      <div class="task-actions">
        <button class="edit-button" type="button" data-edit-task="${task.id}">Edit</button>
        ${
          task.status !== "completed"
            ? `<button class="complete-button" type="button" data-complete-task="${task.id}">Mark Complete</button>`
            : ""
        }
        <button class="delete-button" type="button" data-delete-task="${task.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderTasks() {
  const visibleTasks = getFilteredTasks();
  if (!visibleTasks.length) {
    const emptyMessage = state.tasks.length
      ? "No tasks match the current filters."
      : "No tasks yet. Add your first coursework task above.";
    elements.taskList.innerHTML = `<div class="task-card"><p>${emptyMessage}</p></div>`;
    return;
  }

  elements.taskList.innerHTML = visibleTasks.map(buildTaskCard).join("");
}

function renderSettings() {
  elements.notificationPreference.checked = Boolean(state.preferences.notifications);
  elements.accountName.textContent = state.user?.name || "-";
  elements.accountEmail.textContent = state.user?.email || "-";

  if (!("Notification" in window) || !("PushManager" in window)) {
    elements.pushStatus.textContent = "Push notifications are not supported in this browser.";
  } else if (!state.preferences.notifications) {
    elements.pushStatus.textContent = "Push notifications are currently turned off.";
  } else if (state.preferences.pushSubscribed) {
    elements.pushStatus.textContent = "Push notifications are enabled for this device.";
  } else {
    elements.pushStatus.textContent = "Notification permission is enabled, but this device is not fully subscribed yet.";
  }

  const queuedChanges = state.offlineQueue.length;
  if (!navigator.onLine && queuedChanges) {
    elements.syncStatus.textContent = `Offline: ${queuedChanges} task change(s) queued for sync.`;
  } else if (!navigator.onLine) {
    elements.syncStatus.textContent = "Offline: cached task data is available.";
  } else if (queuedChanges) {
    elements.syncStatus.textContent = `${queuedChanges} offline change(s) ready to sync.`;
  } else {
    elements.syncStatus.textContent = "All changes are synced.";
  }

  elements.syncNowButton.disabled = !navigator.onLine || queuedChanges === 0;
  elements.testPushButton.disabled =
    !navigator.onLine || !state.token || !state.preferences.pushSubscribed;
  elements.installButton.classList.toggle("hidden", !deferredInstallPrompt);
}

function renderAll() {
  renderDashboard();
  renderCategories();
  renderFocusLists();
  renderTasks();
  renderSettings();
}

function setAuthenticatedView(isAuthenticated) {
  elements.authSection.classList.toggle("hidden", isAuthenticated);
  elements.dashboardSection.classList.toggle("hidden", !isAuthenticated);
  elements.logoutButton.classList.toggle("hidden", !isAuthenticated);
  if (isAuthenticated && state.user) {
    elements.welcomeMessage.textContent = `Welcome, ${state.user.name}`;
  }
}

function setAuthTab(mode) {
  const showLogin = mode === "login";
  elements.loginForm.classList.toggle("hidden", !showLogin);
  elements.registerForm.classList.toggle("hidden", showLogin);
  elements.showLoginTab.classList.toggle("active", showLogin);
  elements.showRegisterTab.classList.toggle("active", !showLogin);
  hideMessage(elements.authMessage);
  clearFieldErrors();
}

function resetTaskForm() {
  elements.taskForm.reset();
  elements.taskId.value = "";
  elements.taskPriority.value = "medium";
  elements.taskStatus.value = "pending";
  clearFieldErrors();
}

function fillTaskForm(taskId) {
  const task = findTaskById(taskId);
  if (!task) {
    return;
  }

  elements.taskId.value = task.id;
  elements.taskTitle.value = task.title;
  elements.taskDescription.value = task.description || "";
  elements.taskDueDate.value = toDateTimeLocal(task.due_date);
  elements.taskPriority.value = task.priority;
  elements.taskStatus.value = task.status;
  elements.taskCategory.value = task.category_id || "";
  elements.taskReminder.value =
    task.reminders && task.reminders[0] ? toDateTimeLocal(task.reminders[0].reminder_time) : "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setSettingsState(settings) {
  state.preferences.notifications = Boolean(settings.notification_enabled);
  state.preferences.pushSubscribed = Boolean(settings.push_subscribed);
  saveCache();
}

async function subscribeDeviceToPush() {
  const registration = await ensureServiceWorkerRegistration();
  const keyPayload = await performRequest("/api/push/public-key");
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyPayload.public_key),
    });
  }

  const settings = await performRequest("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  setSettingsState(settings);
}

async function unsubscribeDeviceFromPush() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) {
    return;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  await performRequest(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
    method: "DELETE",
  });
  await subscription.unsubscribe();
}

async function promptInstall() {
  if (!deferredInstallPrompt) {
    showMessage(elements.settingsMessage, "info", "The install prompt is not available right now.");
    return;
  }

  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  renderSettings();
  showMessage(
    elements.settingsMessage,
    outcome.outcome === "accepted" ? "success" : "info",
    outcome.outcome === "accepted"
      ? "The app install prompt was accepted."
      : "The app install prompt was dismissed.",
  );
}

async function loadDashboardData() {
  if (!state.token) {
    return;
  }

  if (!navigator.onLine) {
    state.dashboard = state.dashboard || buildDashboardFromTasks(state.tasks);
    renderAll();
    return;
  }

  const [categories, tasks, settings] = await Promise.all([
    performRequest("/api/categories"),
    performRequest("/api/tasks"),
    performRequest("/api/settings"),
  ]);

  state.categories = categories;
  state.tasks = tasks.map((task) => normalizeTask(task));
  syncDashboardState();
  setSettingsState(settings);
  saveCache();
  renderAll();
}

async function handleLogin(event) {
  event.preventDefault();
  clearFieldErrors();
  hideMessage(elements.authMessage);

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email) {
    setFieldError("loginEmail", "Email is required.");
  }
  if (!password) {
    setFieldError("loginPassword", "Password is required.");
  }
  if (!email || !password) {
    return;
  }

  try {
    const data = await performRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.token = data.access_token;
    state.user = data.user;
    resetUserScopedState();
    saveCache();
    setAuthenticatedView(true);
    showMessage(elements.authMessage, "success", "Login successful.");
    await loadDashboardData();
    await syncOfflineQueue();
  } catch (error) {
    showMessage(elements.authMessage, "error", error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  clearFieldErrors();
  hideMessage(elements.authMessage);

  const name = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;

  if (!name) {
    setFieldError("registerName", "Name is required.");
  }
  if (!email) {
    setFieldError("registerEmail", "Email is required.");
  }
  if (!password || password.length < 8) {
    setFieldError("registerPassword", "Password must be at least 8 characters.");
  }
  if (!name || !email || !password || password.length < 8) {
    return;
  }

  try {
    const data = await performRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    state.token = data.access_token;
    state.user = data.user;
    resetUserScopedState();
    saveCache();
    setAuthenticatedView(true);
    showMessage(elements.authMessage, "success", "Account created successfully.");
    await loadDashboardData();
  } catch (error) {
    showMessage(elements.authMessage, "error", error.message);
  }
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  hideMessage(elements.taskMessage);
  if (!validateTaskForm()) {
    return;
  }

  const payload = {
    title: elements.taskTitle.value.trim(),
    description: elements.taskDescription.value.trim() || null,
    due_date: toApiDateTime(elements.taskDueDate.value),
    priority: elements.taskPriority.value,
    status: elements.taskStatus.value,
    category_id: elements.taskCategory.value ? Number(elements.taskCategory.value) : null,
    reminders: elements.taskReminder.value
      ? [{ reminder_time: toApiDateTime(elements.taskReminder.value) }]
      : [],
  };

  const taskId = elements.taskId.value;
  const path = taskId ? `/api/tasks/${taskId}` : "/api/tasks";
  const method = taskId ? "PUT" : "POST";

  try {
    const savedTask = await api(path, { method, body: JSON.stringify(payload) });
    if (navigator.onLine && savedTask) {
      upsertLocalTask(savedTask);
      syncDashboardState();
      saveCache();
      renderAll();
    }
    resetTaskForm();
    showMessage(
      elements.taskMessage,
      "success",
      navigator.onLine
        ? taskId
          ? "Task updated."
          : "Task created."
        : taskId
          ? "Task saved offline and queued for sync."
          : "Task created offline and queued for sync.",
    );
    if (navigator.onLine) {
      await loadDashboardData();
    }
  } catch (error) {
    showMessage(elements.taskMessage, "error", error.message);
  }
}

async function handleCategorySubmit(event) {
  event.preventDefault();
  setFieldError("categoryName", "");
  const categoryName = elements.categoryName.value.trim();
  if (!categoryName) {
    setFieldError("categoryName", "Category name is required.");
    return;
  }

  if (!navigator.onLine) {
    setFieldError("categoryName", "Module changes require an internet connection.");
    return;
  }

  try {
    await performRequest("/api/categories", {
      method: "POST",
      body: JSON.stringify({ category_name: categoryName }),
    });
    elements.categoryForm.reset();
    await loadDashboardData();
  } catch (error) {
    setFieldError("categoryName", error.message);
  }
}

async function handleTaskListClick(event) {
  const editId = event.target.getAttribute("data-edit-task");
  const completeId = event.target.getAttribute("data-complete-task");
  const deleteId = event.target.getAttribute("data-delete-task");

  if (editId) {
    fillTaskForm(editId);
    return;
  }

  if (completeId) {
    try {
      const updatedTask = await api(`/api/tasks/${completeId}`, {
        method: "PUT",
        body: JSON.stringify({ status: "completed" }),
      });
      if (navigator.onLine && updatedTask) {
        upsertLocalTask(updatedTask);
        syncDashboardState();
        saveCache();
        renderAll();
      }
      showMessage(
        elements.taskMessage,
        "success",
        navigator.onLine
          ? "Task marked as complete."
          : "Completion saved offline and queued for sync.",
      );
      if (navigator.onLine) {
        await loadDashboardData();
      }
    } catch (error) {
      showMessage(elements.taskMessage, "error", error.message);
    }
    return;
  }

  if (deleteId) {
    try {
      await api(`/api/tasks/${deleteId}`, { method: "DELETE" });
      if (navigator.onLine) {
        removeLocalTask(deleteId);
        syncDashboardState();
        saveCache();
        renderAll();
      }
      showMessage(
        elements.taskMessage,
        "success",
        navigator.onLine ? "Task deleted." : "Delete saved offline and queued for sync.",
      );
      if (navigator.onLine) {
        await loadDashboardData();
      }
    } catch (error) {
      showMessage(elements.taskMessage, "error", error.message);
    }
  }
}

function handleFilterChange() {
  state.filters.category = elements.filterCategory.value;
  state.filters.priority = elements.filterPriority.value;
  state.filters.status = elements.filterStatus.value;
  state.filters.sort = elements.sortTasks.value;
  renderTasks();
}

function scrollToTaskForm() {
  elements.taskTitle.focus();
  document.getElementById("taskForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleCategoryListClick(event) {
  const deleteId = event.target.getAttribute("data-delete-category");
  if (!deleteId) {
    return;
  }

  if (!navigator.onLine) {
    setFieldError("categoryName", "Module changes require an internet connection.");
    return;
  }

  try {
    await performRequest(`/api/categories/${deleteId}`, { method: "DELETE" });
    await loadDashboardData();
  } catch (error) {
    setFieldError("categoryName", error.message);
  }
}

async function updateNotificationPreference(enabled) {
  if (!navigator.onLine) {
    elements.notificationPreference.checked = state.preferences.notifications;
    showMessage(elements.settingsMessage, "error", "Notification settings require an internet connection.");
    return;
  }

  if (!enabled) {
    try {
      await unsubscribeDeviceFromPush();
      const settings = await performRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ notification_enabled: false }),
      });
      setSettingsState(settings);
      renderSettings();
      showMessage(elements.settingsMessage, "success", "Push reminders have been turned off.");
    } catch (error) {
      elements.notificationPreference.checked = true;
      showMessage(elements.settingsMessage, "error", error.message);
    }
    return;
  }

  if (!("Notification" in window) || !("PushManager" in window)) {
    elements.notificationPreference.checked = false;
    showMessage(elements.settingsMessage, "error", "Push notifications are not supported in this browser.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    try {
      await subscribeDeviceToPush();
      const settings = await performRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ notification_enabled: true }),
      });
      setSettingsState(settings);
      renderSettings();
      showMessage(elements.settingsMessage, "success", "Push reminders have been enabled for this device.");
    } catch (error) {
      elements.notificationPreference.checked = false;
      state.preferences.notifications = false;
      state.preferences.pushSubscribed = false;
      saveCache();
      renderSettings();
      showMessage(elements.settingsMessage, "error", error.message);
    }
  } else {
    state.preferences.notifications = false;
    state.preferences.pushSubscribed = false;
    saveCache();
    renderSettings();
    showMessage(elements.settingsMessage, "error", "Notification permission was denied.");
  }
}

async function enableNotifications() {
  elements.notificationPreference.checked = true;
  await updateNotificationPreference(true);
}

async function sendTestPushNotification() {
  if (!navigator.onLine) {
    showMessage(elements.settingsMessage, "error", "Go online to send a test notification.");
    return;
  }

  try {
    const result = await performRequest("/api/push/test", { method: "POST" });
    showMessage(elements.settingsMessage, "success", result.message);
  } catch (error) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      showMessage(elements.settingsMessage, "error", error.message);
      return;
    }

    try {
      if (!serviceWorkerRegistration) {
        serviceWorkerRegistration = await ensureServiceWorkerRegistration();
      }

      if (serviceWorkerRegistration && serviceWorkerRegistration.showNotification) {
        await serviceWorkerRegistration.showNotification("Test Notification", {
          body: "Local notification fallback is working for your Student Task Manager.",
          icon: "/icon.svg",
          badge: "/icon.svg",
          tag: "local-test-notification",
          data: { url: "/" },
        });
      } else {
        new Notification("Test Notification", {
          body: "Local notification fallback is working for your Student Task Manager.",
        });
      }

      showMessage(
        elements.settingsMessage,
        "success",
        "Server push could not be delivered, but local notification fallback worked on this device.",
      );
    } catch (fallbackError) {
      showMessage(elements.settingsMessage, "error", error.message);
    }
  }
}

async function syncOfflineQueue() {
  if (!state.token || !navigator.onLine || state.offlineQueue.length === 0) {
    renderSettings();
    return;
  }

  showMessage(elements.settingsMessage, "info", "Syncing offline changes...");
  const queuedActions = [...state.offlineQueue];
  const createdTaskMap = new Map();

  try {
    for (const action of queuedActions) {
      if (action.type === "create") {
        const createdTask = await performRequest("/api/tasks", {
          method: "POST",
          body: JSON.stringify(action.payload),
        });
        createdTaskMap.set(String(action.taskId), createdTask.id);
        continue;
      }

      const resolvedId = createdTaskMap.get(String(action.taskId)) || action.taskId;
      if (isTempId(resolvedId)) {
        continue;
      }

      if (action.type === "update") {
        await performRequest(`/api/tasks/${resolvedId}`, {
          method: "PUT",
          body: JSON.stringify(action.payload),
        });
      }

      if (action.type === "delete") {
        await performRequest(`/api/tasks/${resolvedId}`, { method: "DELETE" });
      }
    }

    state.offlineQueue = [];
    await loadDashboardData();
    showMessage(elements.settingsMessage, "success", "Offline changes synced successfully.");
  } catch (error) {
    showMessage(elements.settingsMessage, "error", `Sync failed: ${error.message}`);
  }

  saveCache();
  renderSettings();
}

async function pollDueReminders() {
  if (
    !state.token ||
    !navigator.onLine ||
    !state.preferences.notifications ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  try {
    const reminders = await performRequest("/api/reminders/due");
    for (const reminder of reminders) {
      if (state.notifiedReminderIds.includes(reminder.id)) {
        continue;
      }

      const notificationBody = `${reminder.task_title} is due now or very soon.`;
      if (serviceWorkerRegistration && serviceWorkerRegistration.showNotification) {
        await serviceWorkerRegistration.showNotification("Task Reminder", {
          body: notificationBody,
          icon: "/icon.svg",
          badge: "/icon.svg",
          tag: `foreground-reminder-${reminder.id}`,
          data: { url: "/" },
        });
      } else {
        new Notification("Task Reminder", {
          body: notificationBody,
        });
      }
      state.notifiedReminderIds.push(reminder.id);
    }
    saveCache();
  } catch (error) {
    console.error(error);
  }
}

function logout() {
  state.token = "";
  state.user = null;
  state.tasks = [];
  state.categories = [];
  state.dashboard = null;
  state.offlineQueue = [];
  state.notifiedReminderIds = [];
  saveCache();
  resetTaskForm();
  hideMessage(elements.settingsMessage);
  setAuthenticatedView(false);
  renderAll();
}

async function handleOnline() {
  updateConnectionUI();
  await syncOfflineQueue();
}

function handleOffline() {
  updateConnectionUI();
}

async function bootstrap() {
  updateConnectionUI();
  elements.sortTasks.value = state.filters.sort;

  if ("serviceWorker" in navigator) {
    try {
      await ensureServiceWorkerRegistration();
    } catch (error) {
      console.error("Service worker registration failed", error);
    }
  }

  setAuthTab("login");
  setAuthenticatedView(Boolean(state.token));

  if (state.token) {
    try {
      await loadDashboardData();
      await syncOfflineQueue();
    } catch (error) {
      logout();
    }
  } else {
    state.dashboard = buildDashboardFromTasks(state.tasks);
    renderAll();
  }

  pollDueReminders();
  setInterval(pollDueReminders, 15000);
}

elements.showLoginTab.addEventListener("click", () => setAuthTab("login"));
elements.showRegisterTab.addEventListener("click", () => setAuthTab("register"));
elements.loginForm.addEventListener("submit", handleLogin);
elements.registerForm.addEventListener("submit", handleRegister);
elements.taskForm.addEventListener("submit", handleTaskSubmit);
elements.categoryForm.addEventListener("submit", handleCategorySubmit);
elements.taskList.addEventListener("click", handleTaskListClick);
elements.categoryList.addEventListener("click", handleCategoryListClick);
elements.logoutButton.addEventListener("click", logout);
elements.notificationButton.addEventListener("click", enableNotifications);
elements.installButton.addEventListener("click", promptInstall);
elements.testPushButton.addEventListener("click", sendTestPushNotification);
elements.notificationPreference.addEventListener("change", (event) => {
  updateNotificationPreference(event.target.checked);
});
elements.quickAddButton.addEventListener("click", scrollToTaskForm);
elements.syncNowButton.addEventListener("click", syncOfflineQueue);
elements.resetTaskButton.addEventListener("click", resetTaskForm);
elements.filterCategory.addEventListener("change", handleFilterChange);
elements.filterPriority.addEventListener("change", handleFilterChange);
elements.filterStatus.addEventListener("change", handleFilterChange);
elements.sortTasks.addEventListener("change", handleFilterChange);
window.addEventListener("online", handleOnline);
window.addEventListener("offline", handleOffline);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderSettings();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  renderSettings();
});

bootstrap();
