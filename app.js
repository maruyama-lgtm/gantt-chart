const STORAGE_KEY = "web-production-gantt-state-v2";
const LEGACY_STORAGE_KEY = "web-production-gantt-state-v1";
const APP_TITLE = "案件管理　工程表";
const DEFAULT_COMPANY_DOMAINS = ["sooon-web.com"];
const MASTER_EMAIL = "maruyama@sooon-web.com";
const GOOGLE_CLIENT_ID = "913052066974-1sdbg5mrjl009h7vnnujcsgpgjinqae2.apps.googleusercontent.com";
const SHARED_STATE_ENDPOINT = "/api/shared-state";
const SYNC_DEBOUNCE_MS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;
const VIEW_DAYS = 42;
const DAY_WIDTH = 40;
const holidayCache = new Map();
const PROGRESS_STATES = [
  { value: 0, label: "未着手" },
  { value: 50, label: "着手中" },
  { value: 100, label: "完了" }
];
const PALETTE = [
  "#206b73",
  "#d9902f",
  "#5675c1",
  "#b65d7a",
  "#55824f",
  "#8b6f47",
  "#5d6470",
  "#b94b4b",
  "#3f8f9c",
  "#8f6cc5",
  "#c17045",
  "#466b50"
];

const STATUS_LABELS = {
  active: {
    title: "進行中の顧客",
    lead: "現在進行中の案件を表示しています。"
  },
  completed: {
    title: "完了した顧客",
    lead: "完了済みの案件を表示しています。"
  },
  scheduled: {
    title: "今後制作予定の顧客",
    lead: "これから制作が始まる予定の案件を表示しています。"
  }
};

const $ = (selector) => document.querySelector(selector);

const refs = {
  loginView: $("#loginView"),
  loginForm: $("#loginForm"),
  googleSignInButton: $("#googleSignInButton"),
  loginError: $("#loginError"),
  appView: $("#appView"),
  appSubtitle: $("#appSubtitle"),
  appTitle: $("#appTitle"),
  dashboardToolbar: $("#dashboardToolbar"),
  settingsToolbar: $("#settingsToolbar"),
  detailToolbar: $("#detailToolbar"),
  dashboardView: $("#dashboardView"),
  settingsView: $("#settingsView"),
  detailView: $("#detailView"),
  customerList: $("#customerList"),
  emptyCustomers: $("#emptyCustomers"),
  customerListTitle: $("#customerListTitle"),
  customerListLead: $("#customerListLead"),
  activeCount: $("#activeCount"),
  completedCount: $("#completedCount"),
  scheduledCount: $("#scheduledCount"),
  masterEmail: $("#masterEmail"),
  googleClientId: $("#googleClientId"),
  allowedEmails: $("#allowedEmails"),
  allowedDomains: $("#allowedDomains"),
  floatingSettingsButton: $("#floatingSettingsButton"),
  projectStatus: $("#projectStatus"),
  projectReportButton: $("#projectReportButton"),
  projectReportHint: $("#projectReportHint"),
  ballOwner: $("#ballOwner"),
  currentWorkNote: $("#currentWorkNote"),
  projectName: $("#projectName"),
  clientName: $("#clientName"),
  customerEmail: $("#customerEmail"),
  ownerName: $("#ownerName"),
  startDate: $("#startDate"),
  endDate: $("#endDate"),
  durationText: $("#durationText"),
  progressText: $("#progressText"),
  progressBar: $("#progressBar"),
  completeText: $("#completeText"),
  memberRows: $("#memberRows"),
  roleRows: $("#roleRows"),
  ganttChart: $("#ganttChart"),
  importFile: $("#importFile"),
  colorDialog: $("#colorDialog"),
  colorChoices: $("#colorChoices"),
  customColor: $("#customColor"),
  toast: $("#toast")
};

let appState = createDefaultAppState();
let state = null;
let editingRoleId = null;
let selectedColor = PALETTE[0];
let sharedSyncTimer = null;
let sharedSyncDisabled = false;
let lastSharedSyncErrorAt = 0;

function todayString() {
  return formatDate(new Date());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDiff(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return 0;
  return Math.round((endDate - startDate) / DAY_MS);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultSettings() {
  return {
    masterEmail: MASTER_EMAIL,
    googleClientId: GOOGLE_CLIENT_ID,
    masterPassword: "",
    allowedEmails: [],
    allowedDomains: [...DEFAULT_COMPANY_DOMAINS]
  };
}

function createDefaultAppState() {
  const active = createProject({
    status: "active",
    project: {
      name: "コーポレートサイト制作",
      client: "株式会社サンプル",
      customerEmail: "client@example.com",
      owner: "山田 太郎 様"
    }
  });
  const completed = createProject({
    status: "completed",
    project: {
      name: "採用サイト改修",
      client: "株式会社完了サンプル",
      customerEmail: "done@example.com",
      owner: "佐藤 花子 様"
    },
    progressOverride: 100
  });
  const scheduled = createProject({
    status: "scheduled",
    dayOffset: 21,
    project: {
      name: "サービスサイト新規制作",
      client: "株式会社予定サンプル",
      customerEmail: "future@example.com",
      owner: "鈴木 一郎 様"
    },
    progressOverride: 0
  });

  return {
    isAuthenticated: false,
    session: null,
    settings: createDefaultSettings(),
    currentView: "login",
    selectedStatus: "active",
    selectedProjectId: active.id,
    projects: [active, completed, scheduled]
  };
}

function createProject(options = {}) {
  const dayOffset = Number(options.dayOffset) || 0;
  const start = formatDate(addDays(parseDate(todayString()), dayOffset));
  const roles = [
    { id: uid("role"), name: "進行管理", color: "#206b73" },
    { id: uid("role"), name: "デザイン", color: "#d9902f" },
    { id: uid("role"), name: "実装", color: "#5675c1" },
    { id: uid("role"), name: "原稿", color: "#b65d7a" },
    { id: uid("role"), name: "確認", color: "#55824f" }
  ];
  const members = [
    { id: uid("member"), name: "PM", roleId: roles[0].id },
    { id: uid("member"), name: "Designer", roleId: roles[1].id },
    { id: uid("member"), name: "Engineer", roleId: roles[2].id },
    { id: uid("member"), name: "Writer", roleId: roles[3].id }
  ];
  const taskDefaults = [
    ["ヒアリング・要件整理", members[0].id, roles[0].id, 0, 4, 100],
    ["サイト構成・ワイヤーフレーム", members[0].id, roles[0].id, 3, 10, 50],
    ["原稿整理・素材回収", members[3].id, roles[3].id, 5, 16, 50],
    ["トップページデザイン", members[1].id, roles[1].id, 10, 18, 50],
    ["下層ページデザイン", members[1].id, roles[1].id, 17, 25, 0],
    ["HTML/CSS実装", members[2].id, roles[2].id, 22, 31, 0],
    ["CMS設定・フォーム調整", members[2].id, roles[2].id, 29, 35, 0],
    ["最終確認・公開", members[0].id, roles[4].id, 36, 40, 0]
  ];
  const progressOverride = Number.isFinite(options.progressOverride) ? options.progressOverride : null;
  const tasks = taskDefaults.map(([name, assigneeId, roleId, startOffset, endOffset, progress]) => ({
    id: uid("task"),
    name,
    assigneeId,
    roleId,
    note: "",
    start: formatDate(addDays(parseDate(start), startOffset)),
    end: formatDate(addDays(parseDate(start), endOffset)),
    progress: progressStateValue(progressOverride === null ? progress : progressOverride)
  }));
  const end = tasks[tasks.length - 1].end;

  return normalizeProject({
    id: options.id || uid("project"),
    status: options.status || "active",
    project: {
      name: "",
      client: "",
      customerEmail: "",
      owner: "",
      start,
      end,
      ...(options.project || {})
    },
    roles,
    members,
    tasks,
    ballOwnerId: members[0].id,
    currentWorkNote: "",
    viewStart: start,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function normalizeProject(input) {
  const fallback = {
    id: input.id || uid("project"),
    status: ["active", "completed", "scheduled"].includes(input.status) ? input.status : "active",
    project: {
      name: "",
      client: "",
      customerEmail: "",
      owner: "",
      start: todayString(),
      end: formatDate(addDays(parseDate(todayString()), 34)),
      ...(input.project || {})
    },
    roles: Array.isArray(input.roles) && input.roles.length ? input.roles : [],
    members: Array.isArray(input.members) && input.members.length ? input.members : [],
    tasks: Array.isArray(input.tasks) ? input.tasks : [],
    ballOwnerId: input.ballOwnerId || "",
    currentWorkNote: String(input.currentWorkNote || input.ballOwnerNote || ""),
    pinned: Boolean(input.pinned),
    viewStart: input.viewStart || input.project?.start || todayString(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };

  if (!fallback.roles.length || !fallback.members.length) {
    const seeded = createProject({
      id: fallback.id,
      status: fallback.status,
      project: fallback.project
    });
    fallback.roles = seeded.roles;
    fallback.members = seeded.members;
    fallback.tasks = seeded.tasks;
  }

  fallback.roles = fallback.roles.map((role, index) => ({
    id: role.id || uid("role"),
    name: String(role.name || `役割 ${index + 1}`),
    color: role.color || PALETTE[index % PALETTE.length]
  }));
  fallback.members = fallback.members.map((member, index) => ({
    id: member.id || uid("member"),
    name: String(member.name || `担当者 ${index + 1}`),
    roleId: fallback.roles.some((role) => role.id === member.roleId) ? member.roleId : fallback.roles[0].id
  }));
  fallback.tasks = fallback.tasks.map((item, index) => ({
    id: item.id || uid("task"),
    name: String(item.name || `工程 ${index + 1}`),
    assigneeId: fallback.members.some((member) => member.id === item.assigneeId)
      ? item.assigneeId
      : fallback.members[0]?.id || "",
    roleId: fallback.roles.some((role) => role.id === item.roleId)
      ? item.roleId
      : fallback.members.find((member) => member.id === item.assigneeId)?.roleId || fallback.roles[0]?.id || "",
    start: item.start || fallback.project.start,
    end: item.end || item.start || fallback.project.start,
    progress: progressStateValue(item.progress),
    note: String(item.note || "")
  }));
  if (!fallback.members.some((member) => member.id === fallback.ballOwnerId)) {
    fallback.ballOwnerId = fallback.members[0]?.id || "";
  }
  return fallback;
}

function normalizeSettings(input) {
  const base = createDefaultSettings();
  const legacyClientId = String(input?.masterPassword || "").includes(".apps.googleusercontent.com")
    ? String(input.masterPassword)
    : "";
  const googleClientId = String(input?.googleClientId || legacyClientId || base.googleClientId).trim();
  const allowedEmails = Array.isArray(input?.allowedEmails)
    ? input.allowedEmails.map(normalizeEmail).filter(Boolean)
    : base.allowedEmails;
  const allowedDomains = Array.isArray(input?.allowedDomains)
    ? input.allowedDomains.map(normalizeDomain).filter(Boolean)
    : base.allowedDomains;
  return {
    masterEmail: MASTER_EMAIL,
    googleClientId,
    masterPassword: "",
    allowedEmails: [...new Set(allowedEmails.filter((email) => email !== MASTER_EMAIL))],
    allowedDomains: [...new Set([...DEFAULT_COMPANY_DOMAINS, ...allowedDomains])]
  };
}

function normalizeAppState(input) {
  if (input && input.project && Array.isArray(input.tasks)) {
    const migrated = normalizeProject({
      ...input,
      id: uid("project"),
      status: "active"
    });
    return {
      isAuthenticated: false,
      session: null,
      settings: createDefaultSettings(),
      currentView: "login",
      selectedStatus: "active",
      selectedProjectId: migrated.id,
      projects: [migrated]
    };
  }

  const base = createDefaultAppState();
  const projects = Array.isArray(input?.projects) && input.projects.length
    ? input.projects.map(normalizeProject)
    : base.projects;
  const selectedProjectId = projects.some((project) => project.id === input?.selectedProjectId)
    ? input.selectedProjectId
    : projects[0].id;

  return {
    isAuthenticated: false,
    session: null,
    settings: normalizeSettings(input?.settings || base.settings),
    currentView: "login",
    selectedStatus: ["active", "completed", "scheduled"].includes(input?.selectedStatus)
      ? input.selectedStatus
      : "active",
    selectedProjectId,
    projects
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!saved) return;
  try {
    appState = normalizeAppState(JSON.parse(saved));
  } catch (error) {
    showToast("保存データを読み込めませんでした");
  }
}

function serializableState() {
  return {
    ...appState,
    isAuthenticated: false,
    session: null,
    currentView: "login"
  };
}

function persistLocalState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(serializableState())
  );
}

function saveState(show = false, options = {}) {
  if (state) state.updatedAt = new Date().toISOString();
  persistLocalState();
  if (options.sync !== false) scheduleSharedSave();
  if (show) showToast("保存しました");
}

function sharedAuthToken() {
  return appState.session?.idToken || "";
}

function scheduleSharedSave() {
  if (sharedSyncDisabled || !appState.isAuthenticated || !sharedAuthToken()) return;
  clearTimeout(sharedSyncTimer);
  sharedSyncTimer = setTimeout(() => {
    saveSharedStateNow().catch((error) => {
      showSharedSyncError(error.message || "共有データを保存できませんでした");
    });
  }, SYNC_DEBOUNCE_MS);
}

async function saveSharedStateNow() {
  if (sharedSyncDisabled || !appState.isAuthenticated || !sharedAuthToken()) return false;
  const response = await fetch(SHARED_STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${sharedAuthToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ state: serializableState() })
  });

  if (response.status === 503) {
    sharedSyncDisabled = true;
    throw new Error("共有ストレージが未設定です。Vercelの環境変数を設定すると共有できます。");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "共有データを保存できませんでした");
  }

  return true;
}

async function loadSharedState(options = {}) {
  if (!appState.isAuthenticated || !sharedAuthToken()) return false;

  const response = await fetch(SHARED_STATE_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${sharedAuthToken()}`
    }
  });

  if (response.status === 503) {
    sharedSyncDisabled = true;
    showSharedSyncError("共有ストレージが未設定です。現在は端末内だけに保存されます。");
    return false;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "共有データを読み込めませんでした");
  }

  const payload = await response.json();
  if (payload.state) {
    const session = appState.session;
    const currentView = appState.currentView === "login" ? "dashboard" : appState.currentView;
    appState = normalizeAppState(payload.state);
    appState.isAuthenticated = true;
    appState.session = session;
    appState.currentView = currentView;
    state = null;
    persistLocalState();
    return true;
  }

  if (options.seedIfEmpty) {
    await saveSharedStateNow();
    return true;
  }

  return false;
}

function showSharedSyncError(message) {
  const now = Date.now();
  if (now - lastSharedSyncErrorAt < 12000) return;
  lastSharedSyncErrorAt = now;
  showToast(message);
}

function currentProject() {
  let project = appState.projects.find((item) => item.id === appState.selectedProjectId);
  if (!project) {
    project = appState.projects[0] || createProject();
    if (!appState.projects.length) appState.projects.push(project);
    appState.selectedProjectId = project.id;
  }
  state = project;
  return project;
}

function renderGoogleLogin() {
  const settings = normalizeSettings(appState.settings);
  appState.settings = settings;
  refs.googleSignInButton.innerHTML = "";

  if (!isConfiguredGoogleClientId(settings.googleClientId)) {
    refs.googleSignInButton.innerHTML = `
      <button class="google-login-button" type="button">
        <span class="google-mark" aria-hidden="true">G</span>
        <span>Googleでログイン</span>
      </button>
    `;
    refs.googleSignInButton.querySelector("button").addEventListener("click", () => {
      refs.loginError.textContent = "Googleログイン設定が未完了です。Google OAuth Client IDを設定してください。";
    });
    refs.loginError.textContent = "";
    return;
  }

  if (!window.google?.accounts?.id) {
    refs.loginError.textContent = "Googleログインを読み込み中です。数秒後に再読み込みしてください。";
    clearTimeout(renderGoogleLogin.timer);
    renderGoogleLogin.timer = setTimeout(renderGoogleLogin, 700);
    return;
  }

  refs.loginError.textContent = "";
  window.google.accounts.id.initialize({
    client_id: settings.googleClientId,
    callback: handleGoogleCredential,
    hd: DEFAULT_COMPANY_DOMAINS[0],
    auto_select: false
  });
  window.google.accounts.id.renderButton(refs.googleSignInButton, {
    theme: "outline",
    size: "large",
    type: "standard",
    text: "signin_with",
    shape: "rectangular",
    logo_alignment: "left",
    locale: "ja",
    width: 320
  });
}

async function handleGoogleCredential(response) {
  try {
    const payload = decodeJwtPayload(response.credential);
    const settings = normalizeSettings(appState.settings);
    const email = normalizeEmail(payload.email);
    const hostedDomain = normalizeDomain(payload.hd);
    const domain = emailDomain(email);
    const isMaster = email === settings.masterEmail;
    const isAllowedDomain = settings.allowedDomains.includes(hostedDomain) || settings.allowedDomains.includes(domain);
    const isAllowedEmail = settings.allowedEmails.includes(email);

    if (!payload.email_verified) {
      refs.loginError.textContent = "Google側でメールアドレス確認が完了していないアカウントです。";
      return;
    }

    if (!isMaster && !isAllowedDomain && !isAllowedEmail) {
      refs.loginError.textContent = `@${DEFAULT_COMPANY_DOMAINS[0]} のGoogleアカウントのみログインできます。`;
      return;
    }

    appState.isAuthenticated = true;
    appState.session = {
      email,
      name: String(payload.name || ""),
      picture: String(payload.picture || ""),
      sub: String(payload.sub || ""),
      authProvider: "google",
      idToken: response.credential,
      isMaster
    };
    appState.currentView = "dashboard";
    appState.selectedStatus = "active";
    refs.loginError.textContent = "";
    persistLocalState();
    try {
      await loadSharedState({ seedIfEmpty: true });
    } catch (syncError) {
      showSharedSyncError(syncError.message || "共有データを読み込めませんでした");
    }
    appState.currentView = "dashboard";
    appState.selectedStatus = ["active", "completed", "scheduled"].includes(appState.selectedStatus)
      ? appState.selectedStatus
      : "active";
    persistLocalState();
    render();
  } catch (error) {
    refs.loginError.textContent = "Googleログイン情報を確認できませんでした。";
  }
}

function decodeJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) throw new Error("Missing JWT payload");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const json = decodeURIComponent(
    atob(paddedBase64)
      .split("")
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
  return JSON.parse(json);
}

function isConfiguredGoogleClientId(value) {
  const clientId = String(value || "").trim();
  return clientId.endsWith(".apps.googleusercontent.com") && clientId !== "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
}

function bindEvents() {
  $("#logoutButton").addEventListener("click", () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    appState.isAuthenticated = false;
    appState.currentView = "login";
    saveState();
    render();
  });

  $("#newProjectButton").addEventListener("click", createNewProject);
  $("#settingsButton").addEventListener("click", openSettings);
  refs.floatingSettingsButton.addEventListener("click", openSettings);
  $("#settingsBackButton").addEventListener("click", () => {
    appState.currentView = "dashboard";
    saveState();
    render();
  });
  $("#settingsSaveButton").addEventListener("click", saveSettings);
  $("#backButton").addEventListener("click", () => {
    appState.currentView = "dashboard";
    appState.selectedStatus = currentProject().status;
    saveState();
    render();
  });

  document.querySelectorAll(".status-tab").forEach((button) => {
    button.addEventListener("click", () => {
      appState.selectedStatus = button.dataset.status;
      renderDashboard();
      saveState();
    });
  });

  document.querySelectorAll(".accordion-toggle").forEach((button) => {
    button.addEventListener("click", () => toggleAccordion(button));
  });

  document.addEventListener("click", () => closeCustomerMenus());

  refs.projectStatus.addEventListener("change", () => {
    currentProject().status = refs.projectStatus.value;
    saveState(true);
    renderDetailHeader();
  });

  ["projectName", "clientName", "customerEmail", "ownerName"].forEach((key) => {
    refs[key].addEventListener("input", () => {
      const map = {
        projectName: "name",
        clientName: "client",
        customerEmail: "customerEmail",
        ownerName: "owner"
      };
      currentProject().project[map[key]] = refs[key].value;
      renderDetailHeader();
      saveState();
    });
  });

  refs.customerEmail.addEventListener("change", () => {
    renderSummary();
    renderGantt();
  });

  ["startDate", "endDate"].forEach((key) => {
    refs[key].addEventListener("change", () => {
      const map = {
        startDate: "start",
        endDate: "end"
      };
      currentProject().project[map[key]] = refs[key].value;
      if (key === "startDate") currentProject().viewStart = refs[key].value || todayString();
      reconcileProjectDates();
      renderDetail();
    });
  });

  $("#saveButton").addEventListener("click", () => saveState(true));
  $("#clearButton").addEventListener("click", clearCurrentProject);
  $("#exportButton").addEventListener("click", exportJson);
  $("#importButton").addEventListener("click", () => refs.importFile.click());
  $("#imageButton").addEventListener("click", exportImage);
  refs.projectReportButton.addEventListener("click", openProjectReportGmail);
  refs.ballOwner.addEventListener("change", () => {
    currentProject().ballOwnerId = refs.ballOwner.value;
    saveState();
    renderBallOwner();
  });
  refs.currentWorkNote.addEventListener("input", () => {
    currentProject().currentWorkNote = refs.currentWorkNote.value;
    saveState();
  });
  refs.importFile.addEventListener("change", importJson);
  $("#addMemberButton").addEventListener("click", addMember);
  $("#addRoleButton").addEventListener("click", addRole);
  $("#addTaskButton").addEventListener("click", addTask);
  $("#prevWeekButton").addEventListener("click", () => moveView(-7));
  $("#nextWeekButton").addEventListener("click", () => moveView(7));
  $("#todayButton").addEventListener("click", () => {
    currentProject().viewStart = mondayOf(parseDate(todayString()));
    renderDetail();
  });
  $("#applyColorButton").addEventListener("click", applyRoleColor);

  refs.colorChoices.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    selectedColor = button.dataset.color;
    refs.customColor.value = selectedColor;
    renderColorChoices();
  });
  refs.customColor.addEventListener("input", () => {
    selectedColor = refs.customColor.value;
    renderColorChoices();
  });
}

function render() {
  refs.floatingSettingsButton.classList.toggle("hidden", !appState.isAuthenticated || !appState.session?.isMaster);

  if (!appState.isAuthenticated) {
    refs.loginView.classList.remove("hidden");
    refs.appView.classList.add("hidden");
    refs.loginError.textContent = "";
    renderGoogleLogin();
    return;
  }

  refs.loginView.classList.add("hidden");
  refs.appView.classList.remove("hidden");

  if (appState.currentView === "detail") {
    refs.dashboardView.classList.add("hidden");
    refs.dashboardToolbar.classList.add("hidden");
    refs.settingsView.classList.add("hidden");
    refs.settingsToolbar.classList.add("hidden");
    refs.detailView.classList.remove("hidden");
    refs.detailToolbar.classList.remove("hidden");
    renderDetail();
    return;
  }

  if (appState.currentView === "settings") {
    refs.dashboardView.classList.add("hidden");
    refs.dashboardToolbar.classList.add("hidden");
    refs.detailView.classList.add("hidden");
    refs.detailToolbar.classList.add("hidden");
    refs.settingsView.classList.remove("hidden");
    refs.settingsToolbar.classList.remove("hidden");
    renderSettings();
    return;
  }

  refs.dashboardView.classList.remove("hidden");
  refs.dashboardToolbar.classList.remove("hidden");
  refs.detailView.classList.add("hidden");
  refs.detailToolbar.classList.add("hidden");
  refs.settingsView.classList.add("hidden");
  refs.settingsToolbar.classList.add("hidden");
  renderDashboard();
}

function renderDashboard() {
  state = null;
  refs.appSubtitle.textContent = "顧客一覧";
  refs.appTitle.textContent = APP_TITLE;
  $("#settingsButton").classList.add("hidden");
  const counts = {
    active: appState.projects.filter((project) => project.status === "active").length,
    completed: appState.projects.filter((project) => project.status === "completed").length,
    scheduled: appState.projects.filter((project) => project.status === "scheduled").length
  };
  refs.activeCount.textContent = counts.active;
  refs.completedCount.textContent = counts.completed;
  refs.scheduledCount.textContent = counts.scheduled;

  document.querySelectorAll(".status-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === appState.selectedStatus);
  });

  const statusCopy = STATUS_LABELS[appState.selectedStatus];
  refs.customerListTitle.textContent = statusCopy.title;
  refs.customerListLead.textContent = statusCopy.lead;
  refs.customerList.innerHTML = "";
  const projects = appState.projects
    .filter((project) => project.status === appState.selectedStatus)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(a.project.start).localeCompare(String(b.project.start)));

  refs.emptyCustomers.classList.toggle("hidden", projects.length > 0);
  projects.forEach((project) => {
    const ballOwner = projectMember(project, project.ballOwnerId);
    const workNote = String(project.currentWorkNote || "").trim();
    const button = document.createElement("div");
    button.className = "customer-card";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.innerHTML = `
      <span class="customer-main">
        <span class="customer-title-line">
          <strong>${escapeHtml(project.project.client || "未設定の顧客")}</strong>
          <span class="customer-work">ボール: ${escapeHtml(ballOwner?.name || "-")} / 作業内容: ${escapeHtml(workNote || "-")}</span>
        </span>
        <span>${escapeHtml(project.project.name || "未設定の工程表")}</span>
      </span>
      <span class="customer-meta">
        <span>期間</span>
        <strong>${escapeHtml(project.project.start || "-")} - ${escapeHtml(project.project.end || "-")}</strong>
      </span>
      <span class="customer-progress">
        <span>進捗</span>
        <strong>${averageProgress(project)}%</strong>
      </span>
      <div class="customer-menu-wrap">
        <button class="customer-menu-button" type="button" aria-label="顧客操作" aria-expanded="false">...</button>
        <div class="customer-menu hidden">
          <button type="button" data-action="delete">削除</button>
          <button type="button" data-action="duplicate">複製</button>
          <button type="button" data-action="pin">${project.pinned ? "固定解除" : "先頭に固定表示"}</button>
        </div>
      </div>
    `;
    button.addEventListener("click", () => openProject(project.id));
    button.addEventListener("keydown", (event) => {
      if (event.target !== button || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      openProject(project.id);
    });
    const menuButton = button.querySelector(".customer-menu-button");
    const menu = button.querySelector(".customer-menu");
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      closeCustomerMenus(menu);
      const isHidden = menu.classList.toggle("hidden");
      menuButton.setAttribute("aria-expanded", String(!isHidden));
    });
    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = event.target.closest("button")?.dataset.action;
      if (action === "delete") deleteProject(project.id);
      if (action === "duplicate") duplicateProject(project.id);
      if (action === "pin") toggleProjectPin(project.id);
    });
    refs.customerList.append(button);
  });
}

function closeCustomerMenus(except = null) {
  document.querySelectorAll(".customer-menu").forEach((menu) => {
    if (menu === except) return;
    menu.classList.add("hidden");
    menu.closest(".customer-menu-wrap")?.querySelector(".customer-menu-button")?.setAttribute("aria-expanded", "false");
  });
}

function openSettings() {
  if (!appState.session?.isMaster) {
    showToast("設定はマスターアカウントのみ変更できます");
    return;
  }
  appState.currentView = "settings";
  render();
}

function toggleAccordion(button) {
  const target = document.getElementById(button.dataset.target);
  if (!target) return;
  const expanded = button.getAttribute("aria-expanded") !== "false";
  button.setAttribute("aria-expanded", String(!expanded));
  target.classList.toggle("collapsed", expanded);
}

function renderSettings() {
  refs.appSubtitle.textContent = "設定";
  refs.appTitle.textContent = APP_TITLE;
  const settings = normalizeSettings(appState.settings);
  appState.settings = settings;
  refs.masterEmail.value = settings.masterEmail;
  refs.googleClientId.value = settings.googleClientId;
  refs.allowedEmails.value = settings.allowedEmails.join("\n");
  refs.allowedDomains.value = settings.allowedDomains.join("\n");
}

function saveSettings() {
  const googleClientId = refs.googleClientId.value.trim();
  const allowedEmails = refs.allowedEmails.value
    .split(/\r?\n|,|、/)
    .map(normalizeEmail)
    .filter(Boolean);
  const allowedDomains = refs.allowedDomains.value
    .split(/\r?\n|,|、/)
    .map(normalizeDomain)
    .filter(Boolean);

  if (!isConfiguredGoogleClientId(googleClientId)) {
    showToast("Google OAuth Client IDを入力してください");
    return;
  }

  appState.settings = normalizeSettings({
    googleClientId,
    allowedEmails,
    allowedDomains
  });
  saveState(true);
  renderSettings();
}

function renderDetail() {
  const project = currentProject();
  refs.projectStatus.value = project.status;
  refs.projectName.value = project.project.name;
  refs.clientName.value = project.project.client;
  refs.customerEmail.value = project.project.customerEmail || "";
  refs.ownerName.value = project.project.owner;
  refs.startDate.value = project.project.start;
  refs.endDate.value = project.project.end;
  renderDetailHeader();
  renderSummary();
  renderMembers();
  renderRoles();
  renderBallOwner();
  refs.currentWorkNote.value = project.currentWorkNote || "";
  renderGantt();
  saveState();
}

function renderDetailHeader() {
  const project = currentProject();
  refs.appSubtitle.textContent = STATUS_LABELS[project.status].title;
  refs.appTitle.textContent = project.project.client || project.project.name || "顧客詳細";
}

function renderSummary() {
  const project = currentProject();
  const duration = project.project.start && project.project.end ? dateDiff(project.project.start, project.project.end) + 1 : 0;
  const completed = project.tasks.filter((task) => Number(task.progress) >= 100).length;
  const average = averageProgress(project);
  refs.durationText.textContent = duration > 0 ? `${duration}日` : "-";
  refs.progressText.textContent = `${average}%`;
  refs.progressBar.style.width = `${average}%`;
  refs.completeText.textContent = `${completed} / ${project.tasks.length}`;
  updateProjectReportButton(project);
}

function averageProgress(project) {
  return project.tasks.length
    ? Math.round(project.tasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / project.tasks.length)
    : 0;
}

function reconcileProjectDates() {
  const project = currentProject();
  const starts = project.tasks.map((task) => task.start).filter(Boolean).sort();
  const ends = project.tasks.map((task) => task.end).filter(Boolean).sort();
  if (!project.project.start && starts[0]) project.project.start = starts[0];
  if (!project.project.end && ends[ends.length - 1]) project.project.end = ends[ends.length - 1];
  if (project.project.start && project.project.end && dateDiff(project.project.start, project.project.end) < 0) {
    project.project.end = project.project.start;
  }
}

function renderMembers() {
  const project = currentProject();
  refs.memberRows.innerHTML = "";
  project.members.forEach((member) => {
    const role = getRole(member.roleId);
    const row = document.createElement("div");
    row.className = "member-row";
    row.innerHTML = `
      <input type="text" value="${escapeAttr(member.name)}" aria-label="担当者名" />
      <select aria-label="役割">${roleOptions(member.roleId)}</select>
      <span class="preview-pill" style="color:${role.color}"><span class="dot"></span>${escapeHtml(role.name)}</span>
      <button class="mini-danger" type="button" aria-label="担当者を削除">x</button>
    `;
    const [nameInput, roleSelect, , deleteButton] = row.children;
    nameInput.addEventListener("input", () => {
      member.name = nameInput.value;
      saveState();
    });
    nameInput.addEventListener("change", () => {
      renderBallOwner();
      renderGantt();
      saveState();
    });
    roleSelect.addEventListener("change", () => {
      member.roleId = roleSelect.value;
      renderDetail();
    });
    deleteButton.addEventListener("click", () => removeMember(member.id));
    refs.memberRows.append(row);
  });
}

function renderBallOwner() {
  const project = currentProject();
  if (!project.members.some((member) => member.id === project.ballOwnerId)) {
    project.ballOwnerId = project.members[0]?.id || "";
  }
  refs.ballOwner.innerHTML = project.members
    .map((member) => `<option value="${escapeAttr(member.id)}" ${member.id === project.ballOwnerId ? "selected" : ""}>${escapeHtml(member.name)}</option>`)
    .join("");
}

function renderRoles() {
  const project = currentProject();
  refs.roleRows.innerHTML = "";
  project.roles.forEach((role) => {
    const row = document.createElement("div");
    row.className = "role-row";
    row.innerHTML = `
      <button class="color-swatch" type="button" style="background:${role.color}" aria-label="役割カラーを変更"></button>
      <input type="text" value="${escapeAttr(role.name)}" aria-label="役割名" />
      <button class="mini-danger" type="button" aria-label="役割を削除">x</button>
    `;
    const [colorButton, nameInput, deleteButton] = row.children;
    colorButton.addEventListener("click", () => openColorDialog(role.id));
    nameInput.addEventListener("input", () => {
      role.name = nameInput.value;
      saveState();
    });
    nameInput.addEventListener("change", () => {
      renderMembers();
      renderGantt();
      saveState();
    });
    deleteButton.addEventListener("click", () => removeRole(role.id));
    refs.roleRows.append(row);
  });
}

function renderGantt() {
  const project = currentProject();
  const viewStart = parseDate(project.viewStart) || parseDate(todayString());
  const days = Array.from({ length: VIEW_DAYS }, (_, index) => addDays(viewStart, index));
  refs.ganttChart.innerHTML = "";

  const header = document.createElement("div");
  header.className = "gantt-header";
  header.innerHTML = `<div class="corner">工程名</div><div class="meta-head">担当 / 進捗</div>`;
  days.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = `day-head ${dayClass(day)}`;
    cell.innerHTML = `<span>${day.getMonth() + 1}/${day.getDate()}</span><small>${weekday(day)}</small>`;
    header.append(cell);
  });
  refs.ganttChart.append(header);

  project.tasks.forEach((task) => {
    const row = document.createElement("div");
    row.className = "gantt-row";
    row.innerHTML = `
      <div class="task-name"><input class="task-title-input" type="text" value="${escapeAttr(task.name)}" aria-label="工程名" /></div>
      <div class="task-meta">
        <div class="task-controls">
          <select aria-label="担当者">${memberOptions(task.assigneeId)}</select>
          <select aria-label="進捗">${progressOptions(task.progress)}</select>
          ${mailButtonHtml(task)}
          <button class="mini-danger" type="button" aria-label="工程を削除">x</button>
        </div>
      </div>
    `;
    days.forEach((day) => {
      const cell = document.createElement("div");
      cell.className = `day-cell ${dayClass(day)}`;
      row.append(cell);
    });

    const layer = document.createElement("div");
    layer.className = "bar-layer";
    const position = barPosition(task, days[0], days[days.length - 1]);
    if (position) {
      const role = getRole(task.roleId || getMember(task.assigneeId)?.roleId);
      const progress = Number(task.progress) || 0;
      const bar = document.createElement("div");
      bar.className = `task-bar ${progress >= 45 ? "is-filled" : ""}`;
      bar.style.gridColumn = `${position.start + 3} / ${position.end + 3}`;
      bar.style.background = tintColor(role.color, 0.82);
      bar.innerHTML = `
        <button class="bar-resize left" type="button" aria-label="開始日を調整"></button>
        <div class="task-bar-fill" style="width:${progress}%; background:${escapeAttr(role.color)}"></div>
        <span>${escapeHtml(task.name)} ${progressLabel(progress)}</span>
        <button class="bar-resize right" type="button" aria-label="完了予定日を調整"></button>
      `;
      bindTaskBarDrag(bar, task);
      layer.append(bar);
    }
    row.append(layer);

    const taskInput = row.querySelector(".task-title-input");
    const controls = row.querySelector(".task-controls");
    const [memberSelect, progressSelect, mailButton, deleteButton] = controls.children;
    taskInput.addEventListener("input", () => {
      task.name = taskInput.value;
      updateTaskBar(row, task);
      saveState();
    });
    taskInput.addEventListener("change", () => {
      renderGantt();
      saveState();
    });
    memberSelect.addEventListener("change", () => {
      task.assigneeId = memberSelect.value;
      const member = getMember(task.assigneeId);
      if (member) task.roleId = member.roleId;
      renderDetail();
    });
    progressSelect.addEventListener("change", () => {
      const previousProgress = Number(task.progress) || 0;
      task.progress = clamp(Number(progressSelect.value) || 0, 0, 100);
      if (previousProgress < 100 && task.progress >= 100) {
        showToast("この工程の進捗報告メールを作成できます");
      }
      renderSummary();
      renderGantt();
      saveState();
    });
    mailButton.addEventListener("click", (event) => {
      if (!isTaskReportReady(currentProject(), task)) {
        event.preventDefault();
        showToast("この工程の完了と顧客メールが必要です");
      }
    });
    deleteButton.addEventListener("click", () => removeTask(task.id));

    refs.ganttChart.append(row);
  });
}

function updateTaskBar(row, task) {
  const bar = row.querySelector(".task-bar");
  if (!bar) return;
  const progress = Number(task.progress) || 0;
  const fill = bar.querySelector(".task-bar-fill");
  const label = bar.querySelector("span");
  bar.classList.toggle("is-filled", progress >= 45);
  if (fill) fill.style.width = `${progress}%`;
  if (label) label.textContent = `${task.name} ${progressLabel(progress)}`;
}

function bindTaskBarDrag(bar, task) {
  bar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const mode = event.target.closest(".bar-resize.left")
      ? "resize-start"
      : event.target.closest(".bar-resize.right")
        ? "resize-end"
        : "move";
    const startX = event.clientX;
    const originalStart = task.start;
    const originalEnd = task.end;
    const originalWidth = bar.getBoundingClientRect().width;
    const maxStartDelta = dateDiff(originalStart, originalEnd) * DAY_WIDTH;
    const minEndDelta = -dateDiff(originalStart, originalEnd) * DAY_WIDTH;
    bar.setPointerCapture(event.pointerId);
    bar.classList.add("dragging");

    const onPointerMove = (moveEvent) => {
      const delta = Math.round((moveEvent.clientX - startX) / DAY_WIDTH);
      const deltaPx = delta * DAY_WIDTH;

      if (mode === "resize-start") {
        const clampedDelta = clamp(deltaPx, -99999, maxStartDelta);
        bar.style.transform = `translateX(${clampedDelta}px)`;
        bar.style.width = `${Math.max(DAY_WIDTH, originalWidth - clampedDelta)}px`;
        return;
      }

      if (mode === "resize-end") {
        const clampedDelta = clamp(deltaPx, minEndDelta, 99999);
        bar.style.transform = "";
        bar.style.width = `${Math.max(DAY_WIDTH, originalWidth + clampedDelta)}px`;
        return;
      }

      bar.style.transform = `translateX(${deltaPx}px)`;
    };

    const onPointerUp = (upEvent) => {
      const delta = Math.round((upEvent.clientX - startX) / DAY_WIDTH);
      bar.classList.remove("dragging");
      bar.style.transform = "";
      bar.style.width = "";
      if (bar.hasPointerCapture(upEvent.pointerId)) {
        bar.releasePointerCapture(upEvent.pointerId);
      }
      bar.removeEventListener("pointermove", onPointerMove);
      bar.removeEventListener("pointerup", onPointerUp);
      bar.removeEventListener("pointercancel", onPointerUp);
      if (delta === 0) return;

      if (mode === "move") {
        task.start = formatDate(addDays(parseDate(originalStart), delta));
        task.end = formatDate(addDays(parseDate(originalEnd), delta));
      } else if (mode === "resize-start") {
        const nextStart = formatDate(addDays(parseDate(originalStart), delta));
        task.start = dateDiff(nextStart, originalEnd) >= 0 ? nextStart : originalEnd;
      } else {
        const nextEnd = formatDate(addDays(parseDate(originalEnd), delta));
        task.end = dateDiff(originalStart, nextEnd) >= 0 ? nextEnd : originalStart;
      }

      reconcileProjectDates();
      renderDetail();
    };

    bar.addEventListener("pointermove", onPointerMove);
    bar.addEventListener("pointerup", onPointerUp);
    bar.addEventListener("pointercancel", onPointerUp);
  });
}

function dayClass(day) {
  const classes = [];
  const wd = day.getDay();
  if (wd === 0 || wd === 6) classes.push("weekend");
  if (isJapaneseHoliday(day)) classes.push("holiday");
  if (formatDate(day) === todayString()) classes.push("today");
  return classes.join(" ");
}

function isJapaneseHoliday(day) {
  return getJapaneseHolidays(day.getFullYear()).has(formatDate(day));
}

function getJapaneseHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);

  const holidays = new Set([
    `${year}-01-01`,
    `${year}-02-11`,
    `${year}-02-23`,
    `${year}-04-29`,
    `${year}-05-03`,
    `${year}-05-04`,
    `${year}-05-05`,
    `${year}-08-11`,
    `${year}-11-03`,
    `${year}-11-23`
  ]);

  holidays.add(nthMonday(year, 1, 2));
  holidays.add(nthMonday(year, 7, 3));
  holidays.add(nthMonday(year, 9, 3));
  holidays.add(nthMonday(year, 10, 2));
  holidays.add(`${year}-03-${String(vernalEquinoxDay(year)).padStart(2, "0")}`);
  holidays.add(`${year}-09-${String(autumnalEquinoxDay(year)).padStart(2, "0")}`);
  addSubstituteHolidays(holidays, year);
  addCitizensHolidays(holidays, year);
  holidayCache.set(year, holidays);
  return holidays;
}

function nthMonday(year, month, nth) {
  const date = new Date(year, month - 1, 1);
  const offset = (8 - date.getDay()) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return formatDate(date);
}

function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function addSubstituteHolidays(holidays, year) {
  const sorted = [...holidays].sort();
  sorted.forEach((dateString) => {
    const date = parseDate(dateString);
    if (!date || date.getFullYear() !== year || date.getDay() !== 0) return;
    let substitute = addDays(date, 1);
    while (holidays.has(formatDate(substitute))) {
      substitute = addDays(substitute, 1);
    }
    if (substitute.getFullYear() === year) holidays.add(formatDate(substitute));
  });
}

function addCitizensHolidays(holidays, year) {
  const start = new Date(year, 0, 2);
  const end = new Date(year, 11, 30);
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const current = formatDate(date);
    if (holidays.has(current)) continue;
    const previous = formatDate(addDays(date, -1));
    const next = formatDate(addDays(date, 1));
    if (holidays.has(previous) && holidays.has(next)) {
      holidays.add(current);
    }
  }
}

function weekday(day) {
  return ["日", "月", "火", "水", "木", "金", "土"][day.getDay()];
}

function mondayOf(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return formatDate(addDays(date, diff));
}

function barPosition(task, viewStart, viewEnd) {
  const start = parseDate(task.start);
  const end = parseDate(task.end);
  if (!start || !end || end < viewStart || start > viewEnd) return null;
  return {
    start: clamp(dateDiff(formatDate(viewStart), formatDate(start)), 0, VIEW_DAYS - 1),
    end: clamp(dateDiff(formatDate(viewStart), formatDate(end)) + 1, 1, VIEW_DAYS)
  };
}

function tintColor(hex, ratio) {
  const normalized = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#e7edf2";
  const amount = clamp(Number(ratio) || 0, 0, 1);
  const channels = normalized.match(/.{2}/g).map((part) => parseInt(part, 16));
  return `#${channels
    .map((value) => Math.round(value + (255 - value) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

function roleOptions(selectedId) {
  return currentProject().roles
    .map((role) => `<option value="${escapeAttr(role.id)}" ${role.id === selectedId ? "selected" : ""}>${escapeHtml(role.name)}</option>`)
    .join("");
}

function memberOptions(selectedId) {
  return currentProject().members
    .map((member) => `<option value="${escapeAttr(member.id)}" ${member.id === selectedId ? "selected" : ""}>${escapeHtml(member.name)}</option>`)
    .join("");
}

function progressOptions(progress) {
  const selectedValue = progressStateValue(progress);
  return PROGRESS_STATES
    .map((state) => `<option value="${state.value}" ${state.value === selectedValue ? "selected" : ""}>${state.label}</option>`)
    .join("");
}

function progressStateValue(progress) {
  const value = Number(progress) || 0;
  if (value >= 100) return 100;
  if (value > 0) return 50;
  return 0;
}

function progressLabel(progress) {
  const value = progressStateValue(progress);
  return PROGRESS_STATES.find((state) => state.value === value)?.label || "未着手";
}

function mailButtonHtml(task) {
  const project = currentProject();
  const ready = isTaskReportReady(project, task);
  const href = ready ? buildGmailComposeUrl(task) : "#";
  const className = ready ? "mail-button ready" : "mail-button disabled";
  const title = ready ? "Gmailで進捗報告メールを作成" : "この工程の完了と顧客メールが必要です";
  return `<a class="${className}" href="${escapeAttr(href)}" target="_blank" rel="noopener" aria-label="${escapeAttr(title)}">${ready ? "送信" : "メール"}</a>`;
}

function isTaskReportReady(project, task) {
  return (Number(task.progress) || 0) >= 100 && Boolean(normalizeEmail(project.project.customerEmail));
}

function completedReportableTasks(project) {
  return project.tasks.filter((task) => isTaskReportReady(project, task));
}

function updateProjectReportButton(project) {
  const ready = completedReportableTasks(project).length > 0;
  refs.projectReportButton.disabled = !ready;
  refs.projectReportHint.textContent = ready
    ? `完了した工程をログイン中のGmail（${appState.session?.email || "Googleアカウント"}）で報告できます。`
    : "完了した工程があり、顧客メールが入力されると送信できます。";
}

function openProjectReportGmail() {
  const project = currentProject();
  if (!completedReportableTasks(project).length) {
    showToast("完了した工程と顧客メールが必要です");
    return;
  }
  window.open(buildGmailComposeUrl(), "_blank", "noopener");
}

function buildGmailComposeUrl(task = null) {
  const project = currentProject();
  const to = normalizeEmail(project.project.customerEmail);
  const subject = task
    ? `【進捗共有】${project.project.name || "工程表"}：${task.name} 完了のご報告`
    : `【進捗共有】${project.project.name || "工程表"}：完了工程のご報告`;
  const completedTasks = completedReportableTasks(project)
    .map((item) => `・${item.name}${item.note ? `（${item.note}）` : ""}`)
    .join("\n");
  const body = [
    `${project.project.client || "お客様"}`,
    "",
    "いつもお世話になっております。",
    `${project.project.name || "制作案件"}について、完了した工程をご報告いたします。`,
    "",
    task ? `今回の報告工程：${task.name}` : "完了工程：",
    task && task.note ? `内容：${task.note}` : "",
    task ? "" : completedTasks,
    `全体進捗：${averageProgress(project)}%`,
    `報告日：${todayString()}`,
    `送信元想定：${appState.session?.email || "ログイン中のGmailアカウント"}`,
    "",
    "内容をご確認のうえ、問題なければGmail画面から送信してください。",
    "",
    "引き続きよろしくお願いいたします。"
  ].join("\n");
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function getRole(id) {
  const project = currentProject();
  return project.roles.find((role) => role.id === id) || project.roles[0] || { id: "", name: "未設定", color: "#5d6470" };
}

function getMember(id) {
  return currentProject().members.find((member) => member.id === id);
}

function projectMember(project, id) {
  return project.members.find((member) => member.id === id) || project.members[0] || null;
}

function createNewProject() {
  const project = createProject({
    status: "active",
    project: {
      name: "新規工程表",
      client: "新規顧客",
      customerEmail: "",
      owner: ""
    }
  });
  appState.projects.unshift(project);
  appState.selectedProjectId = project.id;
  appState.selectedStatus = "active";
  appState.currentView = "detail";
  saveState();
  render();
}

function openProject(projectId) {
  appState.selectedProjectId = projectId;
  appState.currentView = "detail";
  saveState();
  render();
}

function deleteProject(projectId) {
  if (!confirm("この顧客の工程表を削除しますか？")) return;
  appState.projects = appState.projects.filter((project) => project.id !== projectId);
  if (!appState.projects.length) {
    const project = createProject();
    appState.projects.push(project);
    appState.selectedProjectId = project.id;
    appState.selectedStatus = project.status;
  } else if (appState.selectedProjectId === projectId) {
    appState.selectedProjectId = appState.projects[0].id;
  }
  saveState();
  renderDashboard();
}

function duplicateProject(projectId) {
  const source = appState.projects.find((project) => project.id === projectId);
  if (!source) return;
  const copy = normalizeProject(JSON.parse(JSON.stringify(source)));
  const remap = new Map();
  copy.id = uid("project");
  copy.project.name = `${copy.project.name || "工程表"} コピー`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = new Date().toISOString();
  copy.pinned = false;
  copy.roles.forEach((role) => {
    const oldId = role.id;
    role.id = uid("role");
    remap.set(oldId, role.id);
  });
  copy.members.forEach((member) => {
    const oldId = member.id;
    member.id = uid("member");
    member.roleId = remap.get(member.roleId) || member.roleId;
    remap.set(oldId, member.id);
  });
  copy.tasks.forEach((task) => {
    task.id = uid("task");
    task.assigneeId = remap.get(task.assigneeId) || task.assigneeId;
    task.roleId = remap.get(task.roleId) || task.roleId;
  });
  copy.ballOwnerId = remap.get(copy.ballOwnerId) || copy.members[0]?.id || "";
  appState.projects.unshift(copy);
  appState.selectedStatus = copy.status;
  saveState();
  renderDashboard();
  showToast("工程表を複製しました");
}

function toggleProjectPin(projectId) {
  const project = appState.projects.find((item) => item.id === projectId);
  if (!project) return;
  project.pinned = !project.pinned;
  saveState();
  renderDashboard();
}

function addMember() {
  const project = currentProject();
  const role = project.roles[0];
  project.members.push({ id: uid("member"), name: "新規担当者", roleId: role?.id || "" });
  renderDetail();
}

function removeMember(id) {
  const project = currentProject();
  if (project.members.length <= 1) {
    showToast("担当者は1名以上必要です");
    return;
  }
  const fallback = project.members.find((member) => member.id !== id);
  project.tasks.forEach((task) => {
    if (task.assigneeId === id) task.assigneeId = fallback.id;
  });
  project.members = project.members.filter((member) => member.id !== id);
  renderDetail();
}

function addRole() {
  const project = currentProject();
  project.roles.push({
    id: uid("role"),
    name: "新規役割",
    color: PALETTE[project.roles.length % PALETTE.length]
  });
  renderDetail();
}

function removeRole(id) {
  const project = currentProject();
  if (project.roles.length <= 1) {
    showToast("役割は1件以上必要です");
    return;
  }
  const fallback = project.roles.find((role) => role.id !== id);
  project.members.forEach((member) => {
    if (member.roleId === id) member.roleId = fallback.id;
  });
  project.tasks.forEach((task) => {
    if (task.roleId === id) task.roleId = fallback.id;
  });
  project.roles = project.roles.filter((role) => role.id !== id);
  renderDetail();
}

function addTask() {
  const project = currentProject();
  const member = project.members[0];
  const start = project.project.start || todayString();
  project.tasks.push({
    id: uid("task"),
    name: "新規工程",
    assigneeId: member?.id || "",
    roleId: member?.roleId || project.roles[0]?.id || "",
    note: "",
    start,
    end: formatDate(addDays(parseDate(start), 4)),
    progress: 0
  });
  reconcileProjectDates();
  renderDetail();
}

function removeTask(id) {
  const project = currentProject();
  project.tasks = project.tasks.filter((task) => task.id !== id);
  reconcileProjectDates();
  renderDetail();
}

function moveView(days) {
  const project = currentProject();
  const current = parseDate(project.viewStart) || parseDate(todayString());
  project.viewStart = formatDate(addDays(current, days));
  renderDetail();
}

function openColorDialog(roleId) {
  editingRoleId = roleId;
  const role = getRole(roleId);
  selectedColor = role.color;
  refs.customColor.value = selectedColor;
  renderColorChoices();
  refs.colorDialog.showModal();
}

function renderColorChoices() {
  refs.colorChoices.innerHTML = "";
  PALETTE.forEach((color) => {
    const button = document.createElement("button");
    button.className = `color-choice ${color.toLowerCase() === selectedColor.toLowerCase() ? "active" : ""}`;
    button.type = "button";
    button.dataset.color = color;
    button.style.background = color;
    refs.colorChoices.append(button);
  });
}

function applyRoleColor() {
  const role = getRole(editingRoleId);
  role.color = selectedColor;
  refs.colorDialog.close();
  renderDetail();
}

function clearCurrentProject() {
  if (!confirm("現在の工程表をクリアしますか？")) return;
  const current = currentProject();
  const replacement = createProject({
    id: current.id,
    status: current.status,
    project: {
      name: "",
      client: "",
      customerEmail: "",
      owner: ""
    }
  });
  const index = appState.projects.findIndex((project) => project.id === current.id);
  appState.projects[index] = replacement;
  appState.selectedProjectId = replacement.id;
  renderDetail();
  showToast("クリアしました");
}

function exportJson() {
  const project = currentProject();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${safeFileName(project.project.name || project.project.client || "web-production-gantt")}.json`);
  showToast("JSONを書き出しました");
}

function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = normalizeProject({
        ...JSON.parse(String(reader.result)),
        id: currentProject().id,
        status: currentProject().status
      });
      const index = appState.projects.findIndex((project) => project.id === currentProject().id);
      appState.projects[index] = imported;
      appState.selectedProjectId = imported.id;
      renderDetail();
      showToast("JSONを読み込みました");
    } catch (error) {
      showToast("JSONを読み込めませんでした");
    } finally {
      refs.importFile.value = "";
    }
  };
  reader.readAsText(file);
}

function exportImage() {
  const project = currentProject();
  const canvas = document.createElement("canvas");
  const dayWidth = 34;
  const leftWidth = 230;
  const rowHeight = 38;
  const headerHeight = 108;
  const width = leftWidth + dayWidth * VIEW_DAYS;
  const height = headerHeight + 34 + Math.max(1, project.tasks.length) * rowHeight + 28;
  canvas.width = width * 2;
  canvas.height = height * 2;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1c2633";
  ctx.font = "700 24px sans-serif";
  ctx.fillText(project.project.name || "Web制作 工程表", 24, 38);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#647184";
  ctx.fillText(`クライアント: ${project.project.client || "-"}    代表担当者: ${project.project.owner || "-"}`, 24, 64);
  ctx.fillText(`期間: ${project.project.start || "-"} - ${project.project.end || "-"}    進捗: ${averageProgress(project)}%`, 24, 86);

  const viewStart = parseDate(project.viewStart) || parseDate(todayString());
  const days = Array.from({ length: VIEW_DAYS }, (_, index) => addDays(viewStart, index));
  const top = headerHeight;
  ctx.fillStyle = "#f0f4f7";
  ctx.fillRect(0, top, width, 34);
  ctx.strokeStyle = "#dce2ea";
  ctx.strokeRect(0, top, width, 34);
  ctx.fillStyle = "#647184";
  ctx.font = "700 11px sans-serif";
  ctx.fillText("工程名", 14, top + 22);
  days.forEach((day, index) => {
    const x = leftWidth + index * dayWidth;
    ctx.strokeStyle = "#dce2ea";
    ctx.strokeRect(x, top, dayWidth, 34);
    ctx.fillStyle = formatDate(day) === todayString() ? "#d9902f" : "#647184";
    ctx.fillText(`${day.getMonth() + 1}/${day.getDate()}`, x + 4, top + 21);
  });

  project.tasks.forEach((task, index) => {
    const y = top + 34 + index * rowHeight;
    ctx.fillStyle = index % 2 ? "#fbfcfd" : "#ffffff";
    ctx.fillRect(0, y, width, rowHeight);
    ctx.strokeStyle = "#edf1f5";
    ctx.strokeRect(0, y, width, rowHeight);
    ctx.fillStyle = "#1c2633";
    ctx.font = "12px sans-serif";
    ctx.fillText(task.name.slice(0, 26), 14, y + 24);
    days.forEach((day, dayIndex) => {
      const x = leftWidth + dayIndex * dayWidth;
      if ([0, 6].includes(day.getDay()) || isJapaneseHoliday(day)) {
        ctx.fillStyle = "#e7ebef";
        ctx.fillRect(x, y, dayWidth, rowHeight);
      }
      ctx.strokeStyle = "#edf1f5";
      ctx.strokeRect(x, y, dayWidth, rowHeight);
    });
    const position = barPosition(task, days[0], days[days.length - 1]);
    if (position) {
      const role = getRole(task.roleId || getMember(task.assigneeId)?.roleId);
      const x = leftWidth + position.start * dayWidth + 3;
      const barWidth = Math.max(20, (position.end - position.start) * dayWidth - 6);
      const progress = Number(task.progress) || 0;
      ctx.fillStyle = tintColor(role.color, 0.82);
      roundedRect(ctx, x, y + 9, barWidth, 20, 10);
      ctx.fill();
      ctx.fillStyle = role.color;
      roundedRect(ctx, x, y + 9, (barWidth * progress) / 100, 20, 10);
      ctx.fill();
      ctx.fillStyle = progress >= 45 ? "#ffffff" : "#1c2633";
      ctx.font = "700 10px sans-serif";
      ctx.fillText(progressLabel(progress), x + 8, y + 23);
    }
  });

  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("画像を書き出せませんでした");
      return;
    }
    downloadBlob(blob, `${safeFileName(project.project.name || project.project.client || "web-production-gantt")}.png`);
    showToast("画像を書き出しました");
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, "_").trim() || "download";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

function emailDomain(value) {
  const email = normalizeEmail(value);
  return email.includes("@") ? normalizeDomain(email.split("@").pop()) : "";
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.remove("show"), 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

loadState();
bindEvents();
render();
