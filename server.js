// TurboFlow v1.1.1 - fix readJson
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");

loadEnv();

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        fail(new Error("Corpo da requisição muito grande"));
        try { req.destroy(); } catch {}
      }
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;

      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });

    req.on("error", fail);
  });
}



const PORT = Number(process.env.PORT || 3000);
const API = "https://merchant-api.ifood.com.br";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);
const AUTO_CONFIRM = String(process.env.AUTO_CONFIRM || "true").toLowerCase() === "true";
const AUTO_START_PREPARATION = String(process.env.AUTO_START_PREPARATION || "true").toLowerCase() === "true";
const SETTINGS_FILE = path.join(__dirname, "settings.json");

function loadSettings() {
  const defaults = {
    autoConfirm: true,
    autoStartPreparation: true,
    autoReady: true,
    acceptDelaySeconds: 0,
    readyDelaySeconds: 10,
    printSettings: {
      paperWidth: "80",
      fontSize: 12,
      companyFontSize: 28,
      showCnpj: false,
      showCategories: true,
      showDescription: false,
      showAddonGroupTitle: false,
      showCustomer: true,
      showAddress: true,
      showPayment: true,
      showTotal: true,
      showOrderId: true,
      showPhone: false,
      groupIdentical: "separate",
      useAssistant: false,
      autoPrint: false,
      selectedPrinter: "",
      copies: 1
    }
  };
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), "utf8");
      return defaults;
    }
    return { ...defaults, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    return defaults;
  }
}

function saveSettings(next) {
  settings = { ...settings, ...next };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

let settings = loadSettings();
settings.autoReady = settings.autoReady ?? settings.autoDispatch ?? true;
settings.acceptDelaySeconds = Number(settings.acceptDelaySeconds ?? 5);
settings.readyDelaySeconds = Number(settings.readyDelaySeconds ?? settings.dispatchDelaySeconds ?? 10);
settings.printSettings = settings.printSettings || {
  paperWidth: "80",
  fontSize: 12,
  companyFontSize: 28,
  showCnpj: false,
  showCategories: true,
  showDescription: false,
  showAddonGroupTitle: false,
  showCustomer: true,
  showAddress: true,
  showPayment: true,
      showTotal: true,
  showOrderId: true,
  showPhone: false,
  groupIdentical: "separate",
  useAssistant: false,
  autoPrint: false,
  selectedPrinter: "",
  copies: 1
};


const AUTH_FILE = path.join(__dirname, "auth-data.json");
const SESSION_COOKIE = "turboflow_session";
const SESSION_DAYS = 30;

function loadAuthData() {
  const defaults = {
    users: [],
    sessions: []
  };
  try {
    if (!fs.existsSync(AUTH_FILE)) {
      fs.writeFileSync(AUTH_FILE, JSON.stringify(defaults, null, 2), "utf8");
      return defaults;
    }
    const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  } catch (err) {
    console.error("Erro ao carregar auth-data.json:", err.message);
    return defaults;
  }
}

let authData = loadAuthData();

function saveAuthData() {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2), "utf8");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  try {
    const calculated = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256");
    const expected = Buffer.from(expectedHash, "hex");
    return calculated.length === expected.length && crypto.timingSafeEqual(calculated, expected);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  raw.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  });
  return out;
}

function makeSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  authData.sessions = authData.sessions.filter(s => Number(s.expiresAt || 0) > now);
  authData.sessions.push({ token, userId, createdAt: now, expiresAt });
  saveAuthData();
  return { token, expiresAt };
}

function clearSessionToken(token) {
  authData.sessions = authData.sessions.filter(s => s.token !== token);
  saveAuthData();
}

function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const now = Date.now();
  const session = authData.sessions.find(s => s.token === token && Number(s.expiresAt || 0) > now);
  if (!session) return null;
  return authData.users.find(u => u.id === session.userId) || null;
}

function publicUser(user) {
  if (!user) return null;
  const planExpiresAt = user.planExpiresAt || null;
  const expired = planExpiresAt ? new Date(planExpiresAt).getTime() <= Date.now() : false;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    storeName: user.storeName || "",
    cnpj: user.cnpj || "",
    storeConfigured: Boolean(user.storeConfigured),
    storePhone: user.storePhone || "",
    storeAddress: user.storeAddress || "",
    storeCity: user.storeCity || "",
    storeState: user.storeState || "",
    ifoodConnected: Boolean(user.ifoodConnected),
    ifoodMerchantId: user.ifoodMerchantId || "",
    ifoodMerchantName: user.ifoodMerchantName || "",
    ifoodLinkStatus: user.ifoodLinkStatus || (user.ifoodConnected ? "connected" : "none"),
    ifoodRequestedIdentifier: user.ifoodRequestedIdentifier || "",
    ifoodRequestedMerchantId: user.ifoodRequestedMerchantId || "",
    ifoodRequestedAt: user.ifoodRequestedAt || null,
    ifoodAuthMode: user.ifoodAuthMode || "",
    ifoodUserCode: user.ifoodUserCode || "",
    ifoodVerificationUrl: user.ifoodVerificationUrl || "",
    ifoodCodeExpiresAt: user.ifoodCodeExpiresAt || null,
    role: user.role || "customer",
    status: user.status || "pending",
    planDays: Number(user.planDays || 0),
    planStartsAt: user.planStartsAt || null,
    planExpiresAt,
    expired,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt || null,
    lastLoginAt: user.lastLoginAt || null
  };
}

function accountAccessState(user) {
  if (!user) return { allowed: false, reason: "unauthenticated" };
  if (user.role === "admin") return { allowed: true, reason: "admin" };
  if (user.status === "blocked") return { allowed: false, reason: "blocked" };
  if (user.status !== "active") return { allowed: false, reason: "pending" };
  if (!user.planExpiresAt) return { allowed: false, reason: "no_plan" };
  if (new Date(user.planExpiresAt).getTime() <= Date.now()) return { allowed: false, reason: "expired" };
  return { allowed: true, reason: "active" };
}

function requireLogin(req, res) {
  const user = sessionUser(req);
  if (!user) {
    json(res, 401, { ok: false, error: "unauthenticated" });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireLogin(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    json(res, 403, { ok: false, error: "admin_required" });
    return null;
  }
  return user;
}

function requireActiveCustomer(req, res) {
  const user = requireLogin(req, res);
  if (!user) return null;
  const state = accountAccessState(user);
  if (!state.allowed) {
    json(res, 403, { ok: false, error: "account_inactive", reason: state.reason, user: publicUser(user) });
    return null;
  }
  return user;
}

function ensureAdminAccount() {
  const adminEmail = normalizeEmail(process.env.TURBOFLOW_ADMIN_EMAIL || "");
  const adminPassword = String(process.env.TURBOFLOW_ADMIN_PASSWORD || "");
  if (!adminEmail || !adminPassword) return;

  let admin = authData.users.find(u => normalizeEmail(u.email) === adminEmail);
  if (!admin) {
    const p = hashPassword(adminPassword);
    admin = {
      id: crypto.randomUUID(),
      name: "Administrador TurboFlow",
      email: adminEmail,
      passwordSalt: p.salt,
      passwordHash: p.hash,
      role: "admin",
      status: "active",
      planDays: 0,
      planStartsAt: null,
      planExpiresAt: null,
      createdAt: new Date().toISOString()
    };
    authData.users.push(admin);
    saveAuthData();
    console.log("Conta administrador TurboFlow criada.");
  } else if (admin.role !== "admin") {
    admin.role = "admin";
    admin.status = "active";
    saveAuthData();
  }
}

ensureAdminAccount();



const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRest(pathname, options = {}) {
  if (!supabaseConfigured()) throw new Error("Supabase não configurado.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function saveIfoodIntegration(user) {
  if (!supabaseConfigured() || !user?.id) return false;

  const payload = {
    owner_user_id: String(user.id),
    owner_email: user.email || null,
    merchant_id: user.ifoodMerchantId || null,
    merchant_name: user.ifoodMerchantName || null,
    access_token: user.ifoodAccessToken || null,
    refresh_token: user.ifoodRefreshToken || null,
    token_expires_at: user.ifoodTokenExpiresAt || null,
    connected: Boolean(user.ifoodConnected),
    connected_at: user.ifoodConnectedAt || null,
    last_refresh_at: new Date().toISOString()
  };

  await supabaseRest("ifood_integrations?on_conflict=owner_user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: payload
  });
  return true;
}

async function restoreIfoodIntegration(user) {
  if (!supabaseConfigured() || !user?.id) return null;

  const rows = await supabaseRest(
    `ifood_integrations?owner_user_id=eq.${encodeURIComponent(String(user.id))}&limit=1`,
    { method: "GET" }
  );

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;

  user.ifoodMerchantId = row.merchant_id || "";
  user.ifoodMerchantName = row.merchant_name || "";
  user.ifoodAccessToken = row.access_token || "";
  user.ifoodRefreshToken = row.refresh_token || "";
  user.ifoodTokenExpiresAt = row.token_expires_at || null;
  user.ifoodConnectedAt = row.connected_at || null;
  user.ifoodConnected = Boolean(
    row.connected &&
    row.merchant_id &&
    (row.access_token || row.refresh_token)
  );

  // Se já existe token salvo no Supabase, a autorização do iFood foi concluída.
  // Mesmo que o merchant ainda não tenha aparecido, após F5/restart devemos
  // continuar na etapa de espera em vez de voltar para "Gerar código".
  if (user.ifoodConnected) {
    user.ifoodLinkStatus = "connected";
  } else if (row.access_token || row.refresh_token) {
    user.ifoodLinkStatus = "authorized_waiting_merchant";
  } else {
    user.ifoodLinkStatus = user.ifoodLinkStatus || "none";
  }
  return row;
}

async function clearIfoodIntegrationFromSupabase(user) {
  if (!supabaseConfigured() || !user?.id) return;

  await supabaseRest(
    `ifood_integrations?owner_user_id=eq.${encodeURIComponent(String(user.id))}`,
    {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        merchant_id: null,
        merchant_name: null,
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        connected: false,
        connected_at: null,
        last_refresh_at: new Date().toISOString()
      }
    }
  );
}

function ifoodCustomerConnection(user) {
  return {
    connected: Boolean(user && user.ifoodConnected && user.ifoodMerchantId),
    merchantId: user?.ifoodMerchantId || "",
    merchantName: user?.ifoodMerchantName || "",
    connectedAt: user?.ifoodConnectedAt || null,
    linkStatus: user?.ifoodLinkStatus || (user?.ifoodConnected ? "connected" : "none"),
    requestedIdentifier: user?.ifoodRequestedIdentifier || "",
    requestedMerchantId: user?.ifoodRequestedMerchantId || "",
    requestedAt: user?.ifoodRequestedAt || null,
    authMode: user?.ifoodAuthMode || "",
    userCode: user?.ifoodUserCode || "",
    verificationUrl: user?.ifoodVerificationUrl || "",
    codeExpiresAt: user?.ifoodCodeExpiresAt || null
  };
}

function clearIfoodCustomerConnection(user) {
  if (!user) return;
  user.ifoodConnected = false;
  user.ifoodMerchantId = "";
  user.ifoodMerchantName = "";
  user.ifoodAccessToken = "";
  user.ifoodRefreshToken = "";
  user.ifoodTokenExpiresAt = null;
  user.ifoodConnectedAt = null;
  user.ifoodLinkStatus = "none";
  user.ifoodRequestedIdentifier = "";
  user.ifoodRequestedMerchantId = "";
  user.ifoodRequestedAt = null;
  user.ifoodAuthMode = "";
  user.ifoodUserCode = "";
  user.ifoodAuthorizationCodeVerifier = "";
  user.ifoodVerificationUrl = "";
  user.ifoodCodeExpiresAt = null;
  user.ifoodAccessToken = "";
  user.ifoodRefreshToken = "";
  user.ifoodTokenExpiresAt = null;
  user.updatedAt = new Date().toISOString();
  saveAuthData();
}



function cleanEnvCredential(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function productionIfoodClientId() {
  return cleanEnvCredential(process.env.IFOOD_CLIENT_ID);
}

function productionIfoodClientSecret() {
  return cleanEnvCredential(process.env.IFOOD_CLIENT_SECRET);
}

function formEncode(data) {
  return new URLSearchParams(
    Object.entries(data)
      .filter(([,v]) => v !== undefined && v !== null && v !== "")
      .map(([k,v]) => [k, typeof v === "string" ? v.trim() : v])
  ).toString();
}

async function ifoodAuthForm(pathname, data) {
  const response = await fetch(`https://merchant-api.ifood.com.br/authentication/v1.0${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: formEncode(data)
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { raw: text }; }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      `iFood HTTP ${response.status}`;
    const err = new Error(String(message));
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function distributedTokenValid(user) {
  if (!user?.ifoodAccessToken || !user?.ifoodTokenExpiresAt) return false;
  return new Date(user.ifoodTokenExpiresAt).getTime() > Date.now() + 60_000;
}

async function refreshDistributedIfoodToken(user) {
  if (!user?.ifoodRefreshToken) {
    throw new Error("refresh_token_missing");
  }
  const payload = await ifoodAuthForm("/oauth/token", {
    grantType: "refresh_token",
    clientId: productionIfoodClientId(),
    clientSecret: productionIfoodClientSecret(),
    refreshToken: user.ifoodRefreshToken
  });

  const expiresIn = Math.max(60, Number(payload.expiresIn || 0));
  user.ifoodAccessToken = payload.accessToken || payload.access_token || "";
  user.ifoodRefreshToken = payload.refreshToken || payload.refresh_token || user.ifoodRefreshToken;
  user.ifoodTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  user.updatedAt = new Date().toISOString();
  saveAuthData();
  try { await saveIfoodIntegration(user); }
  catch (e) { log("supabase", `Falha ao persistir refresh iFood: ${e.message}`); }
  return user.ifoodAccessToken;
}

async function getDistributedIfoodToken(user) {
  if (distributedTokenValid(user)) return user.ifoodAccessToken;
  return refreshDistributedIfoodToken(user);
}

async function ifoodUserRequest(user, pathname, options = {}) {
  let token = await getDistributedIfoodToken(user);
  const doFetch = async currentToken => {
    const response = await fetch(`https://merchant-api.ifood.com.br${pathname}`, {
      ...options,
      headers: {
        "Accept": "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        "Authorization": `Bearer ${currentToken}`
      }
    });
    return response;
  };

  let response = await doFetch(token);
  if (response.status === 401 && user.ifoodRefreshToken) {
    token = await refreshDistributedIfoodToken(user);
    response = await doFetch(token);
  }

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: text }; }

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `iFood HTTP ${response.status}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return { data, status: response.status };
}

function normalizeIfoodMerchants(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.merchants)) return data.merchants;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function inspectUserIfoodMerchants(user) {
  const { data, status } = await ifoodUserRequest(user, "/merchant/v1.0/merchants");
  const merchants = normalizeIfoodMerchants(data);
  return {
    merchants,
    diagnostic: {
      token: "OK",
      endpoint: "/merchant/v1.0/merchants",
      httpStatus: status,
      merchantCount: merchants.length,
      responseShape: Array.isArray(data)
        ? "array"
        : Array.isArray(data?.merchants)
          ? "merchants"
          : Array.isArray(data?.data)
            ? "data"
            : typeof data
    }
  };
}

async function listUserIfoodMerchants(user) {
  const result = await inspectUserIfoodMerchants(user);
  return result.merchants;
}


async function ifoodRequestForUser(user, endpoint, options = {}) {
  if (homologationModeEnabled()) {
    return hmlIfoodRequest(endpoint, options);
  }
  if (!user || !user.ifoodConnected || !user.ifoodMerchantId) {
    throw new Error("Loja iFood não conectada ao TurboFlow.");
  }
  return ifoodUserRequest(user, endpoint, options);
}

function findUserById(userId) {
  return authData.users.find(u => u.id === userId) || null;
}

function ownerForOrder(order) {
  return order?.ownerUserId ? findUserById(order.ownerUserId) : null;
}


function homologationMerchantIds() {
  const raw = String(process.env.IFOOD_POLLING_MERCHANTS || process.env.IFOOD_HOMOLOGATION_MERCHANT_ID || "").trim();
  if (!raw) return [];
  return raw.split(",").map(x => x.trim()).filter(Boolean);
}

function pollingMerchantHeaderValue() {
  return homologationMerchantIds().join(",");
}

function orderMerchantId(order) {
  return String(
    order?.merchant?.id ||
    order?.merchantId ||
    order?.raw?.merchant?.id ||
    ""
  ).trim();
}

function userCanAccessOrder(user, order) {
  if (!user || user.role === "admin") return true;
  if (!user.ifoodConnected || !user.ifoodMerchantId) return false;
  return orderMerchantId(order) === String(user.ifoodMerchantId);
}

async function listAccessibleIfoodMerchants() {
  const { data } = await ifoodRequest("/merchant/v1.0/merchants");
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.merchants)) return data.merchants;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function addPlanDays(user, days, resetFromNow = false) {
  const normalizedDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const now = new Date();
  const currentExpiry = user.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const base = !resetFromNow && currentExpiry && currentExpiry.getTime() > now.getTime()
    ? currentExpiry
    : now;

  const expires = new Date(base.getTime() + normalizedDays * 24 * 60 * 60 * 1000);
  user.status = "active";
  user.planDays = normalizedDays;
  user.planStartsAt = now.toISOString();
  user.planExpiresAt = expires.toISOString();
  user.approvedAt = user.approvedAt || now.toISOString();
  user.updatedAt = now.toISOString();
  saveAuthData();
  return user;
}

let tokenCache = { accessToken: null, expiresAt: 0 };

const hmlAuthPath = path.join(__dirname, "data", "ifood-homologation.json");

function loadHmlAuth() {
  try {
    if (!fs.existsSync(hmlAuthPath)) return {};
    return JSON.parse(fs.readFileSync(hmlAuthPath, "utf8")) || {};
  } catch {
    return {};
  }
}

function saveHmlAuth(data) {
  fs.mkdirSync(path.dirname(hmlAuthPath), { recursive: true });
  fs.writeFileSync(hmlAuthPath, JSON.stringify(data, null, 2));
}

let hmlAuth = loadHmlAuth();


function ifoodEventMode() {
  // Nesta versão o iFood usa exclusivamente POLLING.
  return "POLLING";
}

function homologationModeEnabled() {
  return String(process.env.IFOOD_HOMOLOGATION_MODE || "").trim().toLowerCase() === "true";
}

function hmlClientId() {
  return String(process.env.IFOOD_HML_CLIENT_ID || "").trim();
}
function hmlClientSecret() {
  return String(process.env.IFOOD_HML_CLIENT_SECRET || "").trim();
}

async function hmlAuthForm(pathname, data) {
  const response = await fetch(`${API}/authentication/v1.0${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams(Object.entries(data).filter(([,v]) => v !== undefined && v !== null && v !== ""))
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    const msg = payload?.message || payload?.error_description || payload?.error || JSON.stringify(payload);
    throw new Error(`iFood homologação ${response.status}: ${msg}`);
  }
  return payload || {};
}

function hmlTokenValid() {
  return Boolean(hmlAuth.accessToken && hmlAuth.expiresAt && Date.now() < hmlAuth.expiresAt - 60000);
}

async function refreshHmlToken() {
  if (!hmlAuth.refreshToken) throw new Error("Refresh token de homologação não configurado.");
  const payload = await hmlAuthForm("/oauth/token", {
    grantType: "refresh_token",
    clientId: hmlClientId(),
    clientSecret: hmlClientSecret(),
    refreshToken: hmlAuth.refreshToken
  });
  hmlAuth.accessToken = payload.accessToken || payload.access_token || "";
  hmlAuth.refreshToken = payload.refreshToken || payload.refresh_token || hmlAuth.refreshToken;
  const expiresIn = Number(payload.expiresIn || payload.expires_in || 21600);
  hmlAuth.expiresAt = Date.now() + expiresIn * 1000;
  saveHmlAuth(hmlAuth);
  return hmlAuth.accessToken;
}

async function getHmlToken() {
  if (hmlTokenValid()) return hmlAuth.accessToken;
  return refreshHmlToken();
}

async function hmlIfoodRequest(endpoint, options = {}) {
  let token = await getHmlToken();
  const doReq = async currentToken => {
    const headers = {
      Authorization: `Bearer ${currentToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };
    return fetch(`${API}${endpoint}`, { ...options, headers });
  };
  let res = await doReq(token);
  if (res.status === 401 && hmlAuth.refreshToken) {
    token = await refreshHmlToken();
    res = await doReq(token);
  }
  const data = await parseResponse(res);
  if (!res.ok) throw new Error(`iFood HML ${options.method || "GET"} ${endpoint} -> ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}

let hmlPolling = false;
async function pollHmlEvents() {
  if (hmlPolling || !hmlAuth.accessToken) return;
  hmlPolling = true;
  try {
    // Durante o teste de conectividade da homologação distribuída, não force
    // x-polling-merchants. O heartbeat precisa ser identificado pelo client do
    // aplicativo (D), não como merchant:<uuid>. O token D já limita o acesso
    // aos merchants autorizados.
    const merchantHeader = pollingMerchantHeaderValue();

    const { data } = await hmlIfoodRequest("/events/v1.0/events:polling", {
      headers: merchantHeader
        ? { "x-polling-merchants": merchantHeader }
        : {}
    });

    const events = Array.isArray(data) ? data : (data?.events || []);
    if (!events.length) return;

    const ids = [];
    for (const event of events) {
      try {
        await processEvent(event);
      } finally {
        if (event?.id) ids.push(event.id);
      }
    }

    if (ids.length) {
      await hmlIfoodRequest("/events/v1.0/events/acknowledgment", {
        method: "POST",
        body: JSON.stringify(ids.map(id => ({ id })))
      });
      log("hml-ack", `${ids.length} evento(s) de homologação confirmado(s).`);
    }
  } catch (err) {
    log("hml-error", err.message);
  } finally {
    hmlPolling = false;
  }
}

let orders = new Map();
let eventsLog = [];
let isPolling = false;

const autoConfirmDone = new Set();
const autoStartDone = new Set();
const autoReadyDone = new Set();

const confirmTimers = new Map();
const readyTimers = new Map();

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function log(type, message, data = null) {
  const item = { at: new Date().toISOString(), type, message, data };
  eventsLog.unshift(item);
  eventsLog = eventsLog.slice(0, 100);
  console.log(`[${item.at}] ${type}: ${message}`);
}

async function getToken() {
  if (homologationModeEnabled()) {
    throw new Error("IFOOD_HOMOLOGATION_MODE=true: Teste (C) desativado.");
  }

  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) return tokenCache.accessToken;

  const clientId = productionIfoodClientId();
  const clientSecret = productionIfoodClientSecret();
  if (!clientId || !clientSecret) throw new Error("Preencha IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET no arquivo .env");

  const body = new URLSearchParams({
    grantType: "client_credentials",
    clientId,
    clientSecret
  });

  const res = await fetch(`${API}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await parseResponse(res);
  if (!res.ok) throw new Error(`Falha ao autenticar no iFood (${res.status}): ${JSON.stringify(data)}`);

  const accessToken = data.accessToken || data.access_token;
  const expiresIn = Number(data.expiresIn || data.expires_in || 21600);
  if (!accessToken) throw new Error("O iFood não retornou accessToken.");

  tokenCache = { accessToken, expiresAt: now + expiresIn * 1000 };
  log("auth", "Token do iFood atualizado.");
  return accessToken;
}

async function ifoodRequest(endpoint, options = {}) {
  if (homologationModeEnabled()) {
    if (hmlAuth && (hmlAuth.accessToken || hmlAuth.refreshToken)) {
      return hmlIfoodRequest(endpoint, options);
    }
    throw new Error("Modo homologação ativo, mas o Teste (D) ainda não foi autorizado.");
  }

  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${API}${endpoint}`, { ...options, headers });
  const data = await parseResponse(res);
  if (!res.ok) throw new Error(`iFood ${options.method || "GET"} ${endpoint} -> ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}


const processedWebhookEvents = new Map();
const processed99FoodWebhookEvents = new Map();

function cleanupWebhookIds() {
  const cutoff = Date.now() - (8 * 60 * 60 * 1000);
  for (const [id, ts] of processedWebhookEvents.entries()) {
    if (ts < cutoff) processedWebhookEvents.delete(id);
  }
}

function validateWebhookSignature(rawBody, receivedSignature) {
  const secret = productionIfoodClientSecret();
  if (!secret || !receivedSignature) return false;

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(String(expectedHex).toLowerCase(), "utf8");
  const b = Buffer.from(String(receivedSignature).trim().toLowerCase(), "utf8");

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleWebhook(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  const signature = req.headers["x-ifood-signature"];
  if (!validateWebhookSignature(rawBody, signature)) {
    log("security", "Webhook rejeitado: assinatura inválida.");
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "invalid signature" }));
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "invalid json" }));
  }

  // Responde rápido; o processamento continua em seguida.
  res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ accepted: true }));

  const events = Array.isArray(payload) ? payload : [payload];

  setImmediate(async () => {
    cleanupWebhookIds();

    for (const event of events) {
      const eventId = event?.id;
      if (eventId && processedWebhookEvents.has(eventId)) {
        log("webhook", `Evento duplicado ignorado: ${eventId}`);
        continue;
      }

      try {
        if (eventId) processedWebhookEvents.set(eventId, Date.now());

        const code = String(event?.code || event?.fullCode || "").toUpperCase();

        // KEEPALIVE é recebido e registrado; presença avançada será configurada
        // quando tivermos a URL pública e o payload real do portal.
        if (code === "KEEPALIVE") {
          log("heartbeat", "KEEPALIVE recebido no fluxo de eventos iFood.");
          continue;
        }

        log("webhook", `Evento em tempo real: ${code || "EVENTO"} ${event?.orderId || ""}`.trim());
        await processEvent(event);
      } catch (err) {
        log("error", `Erro no processamento do webhook: ${err.message}`, event);
      }
    }
  });
}


function cleanup99FoodWebhookIds() {
  const cutoff = Date.now() - (8 * 60 * 60 * 1000);
  for (const [id, ts] of processed99FoodWebhookEvents.entries()) {
    if (ts < cutoff) processed99FoodWebhookEvents.delete(id);
  }
}

async function handle99FoodWebhook(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  let payload = {};
  if (rawBody.length) {
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      log("99food-error", "Webhook 99Food recebeu JSON inválido.");
      return json(res, 400, { ok: false, error: "invalid_json" });
    }
  }

  // Resposta rápida para a plataforma.
  json(res, 200, { ok: true });

  // Processamento inicial: registrar com segurança sem alterar o fluxo do iFood.
  setImmediate(() => {
    try {
      cleanup99FoodWebhookIds();

      const events = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.events) ? payload.events : [payload]);

      for (const event of events) {
        const eventId =
          event?.id ||
          event?.eventId ||
          event?.event_id ||
          event?.requestId ||
          event?.request_id ||
          null;

        if (eventId && processed99FoodWebhookEvents.has(String(eventId))) {
          log("99food-webhook", `Evento duplicado ignorado: ${eventId}`);
          continue;
        }

        if (eventId) {
          processed99FoodWebhookEvents.set(String(eventId), Date.now());
        }

        const eventType =
          event?.type ||
          event?.eventType ||
          event?.event_type ||
          event?.code ||
          event?.status ||
          "EVENTO";

        const orderId =
          event?.orderId ||
          event?.order_id ||
          event?.order?.id ||
          "";

        log(
          "99food-webhook",
          `Evento recebido: ${String(eventType)} ${String(orderId)}`.trim(),
          event
        );
      }
    } catch (err) {
      log("99food-error", `Erro ao registrar webhook: ${err.message}`);
    }
  });
}

async function pollEvents() {
  if (homologationModeEnabled()) return;
  if (isPolling) return;
  isPolling = true;

  try {
    const connectedUsers = authData.users.filter(
      u => u.role !== "admin" &&
           u.ifoodConnected &&
           u.ifoodMerchantId &&
           (u.ifoodAccessToken || u.ifoodRefreshToken)
    );

    if (!connectedUsers.length) return;

    for (const user of connectedUsers) {
      try {
        const merchantId = String(user.ifoodMerchantId || "").trim();
        const { data } = await ifoodUserRequest(
          user,
          "/events/v1.0/events:polling",
          { headers: merchantId ? { "x-polling-merchants": merchantId } : {} }
        );

        const events = Array.isArray(data) ? data : (data?.events || []);
        if (!events.length) continue;

        events.sort((a,b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

        const processedIds = [];
        for (const event of events) {
          try {
            await processEvent(event, user);
            if (event.id) processedIds.push(event.id);
          } catch (err) {
            log("error", `Erro processando evento ${event.id || "sem-id"} da loja ${merchantId}: ${err.message}`, event);
          }
        }

        if (processedIds.length) {
          const acknowledgmentBody = processedIds.map(id => ({ id }));
          await ifoodUserRequest(user, "/events/v1.0/events/acknowledgment", {
            method: "POST",
            body: JSON.stringify(acknowledgmentBody)
          });
          log("ack", `${processedIds.length} evento(s) confirmado(s) — merchant ${merchantId}.`);
        }
      } catch (err) {
        log("error", `Polling distribuído falhou para ${user.ifoodMerchantId || user.id}: ${err.message}`);
      }
    }
  } finally {
    isPolling = false;
  }
}

async function processEvent(event, activeUser = null) {
  const code = String(event.code || event.fullCode || "").toUpperCase();
  const orderId = event.orderId || event.order?.id;
  log("event", `${code || "EVENTO"} ${orderId || ""}`.trim(), event);

  if (!orderId) return;

  // Novo pedido: busca detalhes imediatamente e agenda o aceite.
  if (["PLACED", "PLC"].includes(code) || code.includes("PLACED")) {
    const detail = await getOrderDetail(orderId, activeUser);
    const normalized = normalizeOrder(detail);
    normalized.status = "PLACED";
    normalized.stage = "NEW";
    normalized.receivedAt = normalized.receivedAt || new Date().toISOString();
    if (activeUser?.id) normalized.ownerUserId = activeUser.id;
    if (activeUser?.ifoodMerchantId && !normalized.merchant) {
      normalized.merchant = { id: activeUser.ifoodMerchantId, name: activeUser.ifoodMerchantName || "" };
    }
    orders.set(orderId, normalized);

    if (settings.autoConfirm && !autoConfirmDone.has(orderId) && !confirmTimers.has(orderId)) {
      scheduleAutoConfirm(orderId, activeUser);
    }
    return;
  }

  // Confirmado: entra em preparo e agenda "pronto para retirada".
  if (["CONFIRMED", "CFM"].includes(code) || code.includes("CONFIRMED")) {
    const current = orders.get(orderId) || { id: orderId, ownerUserId: activeUser?.id, merchant: activeUser?.ifoodMerchantId ? { id: activeUser.ifoodMerchantId, name: activeUser.ifoodMerchantName || "" } : undefined };
    current.status = "CONFIRMED";
    current.stage = "PREPARATION";
    current.preparationStartedAt = current.preparationStartedAt || new Date().toISOString();
    current.updatedAt = new Date().toISOString();
    current.confirmDueAt = null;
    orders.set(orderId, current);

    if (settings.autoStartPreparation && !autoStartDone.has(orderId)) {
      autoStartDone.add(orderId);
      await actionStartPreparation(orderId, activeUser);
      log("auto", `Início de preparo automático executado para ${orderId}.`);
    }

    if (settings.autoReady && !autoReadyDone.has(orderId) && !readyTimers.has(orderId)) {
      scheduleAutoReady(orderId, activeUser);
    }
    return;
  }

  // Preparando. Mantém/agendas o timer de pronto se ainda necessário.
  if (["PRS", "DDCR"].includes(code) || code.includes("PREPAR")) {
    const current = orders.get(orderId) || { id: orderId, ownerUserId: activeUser?.id, merchant: activeUser?.ifoodMerchantId ? { id: activeUser.ifoodMerchantId, name: activeUser.ifoodMerchantName || "" } : undefined };
    current.status = "PREPARATION";
    current.stage = "PREPARATION";
    current.updatedAt = new Date().toISOString();
    orders.set(orderId, current);

    if (settings.autoReady && !autoReadyDone.has(orderId) && !readyTimers.has(orderId)) {
      scheduleAutoReady(orderId, activeUser);
    }
    return;
  }

  // Ready to pickup: pedido pronto, esperando entregador.
  if (["RTP", "READY_TO_PICKUP", "READYTOPICKUP"].includes(code) || code.includes("READY_TO_PICKUP")) {
    const current = orders.get(orderId) || { id: orderId, ownerUserId: activeUser?.id, merchant: activeUser?.ifoodMerchantId ? { id: activeUser.ifoodMerchantId, name: activeUser.ifoodMerchantName || "" } : undefined };
    current.status = "READY_TO_PICKUP";
    current.stage = "READY";
    current.readyAt = current.readyAt || new Date().toISOString();
    current.readyDueAt = null;
    current.updatedAt = new Date().toISOString();
    orders.set(orderId, current);
    autoReadyDone.add(orderId);
    return;
  }

  // DISPATCHED: o entregador já saiu com o pedido.
  if (["DSP", "DISPATCHED"].includes(code) || code.includes("DISPATCH")) {
    const current = orders.get(orderId) || { id: orderId, ownerUserId: activeUser?.id, merchant: activeUser?.ifoodMerchantId ? { id: activeUser.ifoodMerchantId, name: activeUser.ifoodMerchantName || "" } : undefined };
    current.status = "DISPATCHED";
    current.stage = "DELIVERY";
    current.dispatchedAt = current.dispatchedAt || new Date().toISOString();
    current.updatedAt = new Date().toISOString();
    orders.set(orderId, current);
    return;
  }

  const current = orders.get(orderId) || { id: orderId, ownerUserId: activeUser?.id, merchant: activeUser?.ifoodMerchantId ? { id: activeUser.ifoodMerchantId, name: activeUser.ifoodMerchantName || "" } : undefined };

  if (["DSP", "DISPATCHED"].includes(code) || code.includes("DISPATCHED")) {
    current.status = "DISPATCHED";
    current.stage = "DELIVERY";
    current.isClosed = false;
    current.updatedAt = new Date().toISOString();
  } else if (["RTP", "READY_TO_PICKUP"].includes(code) || code.includes("READY_TO_PICKUP")) {
    current.status = "READY_TO_PICKUP";
    current.stage = "READY";
    current.isClosed = false;
    current.updatedAt = new Date().toISOString();
  } else if (["CANCELLATION_REQUEST_FAILED", "CRF"].includes(code)) {
    current.status = "CANCELLATION_REQUEST_FAILED";
    current.stage = "ATTENTION";
    current.updatedAt = new Date().toISOString();
  } else if (["CAN", "CANCELLED", "CANCELED"].includes(code) || code === "CANCELLED" || code.includes("CANCELLED")) {
    current.status = "CANCELLED";
    current.stage = "FINISHED";
    current.isClosed = true;
  } else if (["CON", "CONCLUDED", "COMPLETED"].includes(code) || code.includes("CONCLUD") || code.includes("COMPLET")) {
    current.status = "CONCLUDED";
    current.stage = "FINISHED";
    current.finishedAt = current.finishedAt || new Date().toISOString();
    current.isClosed = true;
  } else {
    current.status = code || current.status || "UPDATED";
  }

  current.updatedAt = new Date().toISOString();
  orders.set(orderId, current);
}

async function getOrderDetail(id, activeUser = null) {
  const { data } = await ifoodRequestForUser(activeUser, `/order/v1.0/orders/${encodeURIComponent(id)}`);
  return data;
}

function normalizeOrder(o) {
  return {
    id: o.id,
    displayId: o.displayId || o.shortReference || o.id?.slice(0, 8),
    status: o.status || "PLACED",
    orderType: o.orderType,
    category: o.category,
    createdAt: o.createdAt || o.createdDate || o.orderTiming || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    merchant: o.merchant,
    customer: o.customer,
    items: o.items || [],
    total: o.total,
    delivery: o.delivery,
    raw: o
  };
}


function scheduleAutoConfirm(id, activeUser = null) {
  // Na homologação, o aceite automático continua funcionando.
  // Isso preserva o comportamento já validado na Etapa 2.
  if (!settings.autoConfirm || autoConfirmDone.has(id)) return;
  if (confirmTimers.has(id)) clearTimeout(confirmTimers.get(id));

  const delayMs = 0; // v6.0: aceite automático imediato assim que o evento chegar pelo polling
  const dueAt = Date.now() + delayMs;

  const current = orders.get(id) || { id };
  current.stage = "NEW";
  current.confirmDueAt = new Date(dueAt).toISOString();
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);

  log("timer", `Pedido ${id}: aceite automático em ${Math.round(delayMs/1000)}s.`);

  const timer = setTimeout(async () => {
    try {
      const now = orders.get(id);
      if (now?.isClosed || autoConfirmDone.has(id)) return;

      await actionConfirm(id, activeUser || ownerForOrder(orders.get(id)));
      autoConfirmDone.add(id);
      log("auto", `Aceite automático executado para ${id}.`);
    } catch (err) {
      log("error", `Falha no aceite automático de ${id}: ${err.message}`);
    } finally {
      confirmTimers.delete(id);
    }
  }, delayMs);

  confirmTimers.set(id, timer);
}

function scheduleAutoReady(id, activeUser = null) {
  if (homologationModeEnabled()) {
    log("hml-manual", `Homologação: marcar pronto automático bloqueado para ${id}.`);
    return;
  }
  if (!settings.autoReady || autoReadyDone.has(id)) return;
  if (readyTimers.has(id)) clearTimeout(readyTimers.get(id));

  const delayMs = Math.max(0, Number(settings.readyDelaySeconds || 10)) * 1000;
  const dueAt = Date.now() + delayMs;

  const current = orders.get(id) || { id };
  current.stage = "PREPARATION";
  current.readyDueAt = new Date(dueAt).toISOString();
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);

  log("timer", `Pedido ${id}: ficará pronto em ${Math.round(delayMs/1000)}s.`);

  const timer = setTimeout(async () => {
    try {
      const now = orders.get(id);
      if (now?.isClosed || autoReadyDone.has(id)) return;

      await actionReadyToPickup(id, activeUser || ownerForOrder(orders.get(id)));
      autoReadyDone.add(id);

      const updated = orders.get(id) || { id };
      updated.status = "READY_REQUESTED";
      updated.stage = "READY";
      updated.readyAt = updated.readyAt || new Date().toISOString();
      updated.readyDueAt = null;
      updated.updatedAt = new Date().toISOString();
      orders.set(id, updated);

      log("auto", `Pedido marcado como pronto automaticamente: ${id}.`);
    } catch (err) {
      log("error", `Falha ao marcar ${id} como pronto: ${err.message}`);
    } finally {
      readyTimers.delete(id);
    }
  }, delayMs);

  readyTimers.set(id, timer);
}

async function actionConfirm(id, activeUser = null) {
  await ifoodRequestForUser(activeUser || ownerForOrder(orders.get(id)), `/order/v1.0/orders/${encodeURIComponent(id)}/confirm`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "CONFIRM_REQUESTED";
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Confirmação enviada para ${id}`);
  return current;
}

async function actionStartPreparation(id, activeUser = null) {
  await ifoodRequestForUser(activeUser || ownerForOrder(orders.get(id)), `/order/v1.0/orders/${encodeURIComponent(id)}/startPreparation`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "PREPARATION_REQUESTED";
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Início de preparo enviado para ${id}`);
  return current;
}

async function actionReadyToPickup(id, activeUser = null) {
  await ifoodRequestForUser(activeUser || ownerForOrder(orders.get(id)), `/order/v1.0/orders/${encodeURIComponent(id)}/readyToPickup`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "READY_REQUESTED";
  current.stage = "READY";
  current.readyDueAt = null;
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Pedido pronto enviado para ${id}`);
  return current;
}

async function actionDispatch(id, activeUser = null) {
  await ifoodRequestForUser(activeUser || ownerForOrder(orders.get(id)), `/order/v1.0/orders/${encodeURIComponent(id)}/dispatch`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "DISPATCH_REQUESTED";
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Despacho enviado para ${id}`);
  return current;
}

async function handleApi(req, res, url) {
  
  // ===== TurboFlow SaaS: autenticação e planos =====
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const phone = String(body.phone || "").trim();
    const storeName = String(body.storeName || "").trim();
    const cnpj = String(body.cnpj || "").trim();

    if (!name || !email || password.length < 6) {
      return json(res, 400, { ok: false, error: "invalid_registration" });
    }
    if (authData.users.some(u => normalizeEmail(u.email) === email)) {
      return json(res, 409, { ok: false, error: "email_exists" });
    }

    const p = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      phone,
      passwordSalt: p.salt,
      passwordHash: p.hash,
      storeName,
      cnpj,
      role: "customer",
      status: "pending",
      planDays: 0,
      planStartsAt: null,
      planExpiresAt: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      lastLoginAt: null
    };
    authData.users.push(user);
    saveAuthData();

    return json(res, 201, { ok: true, status: "pending", user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const user = authData.users.find(u => normalizeEmail(u.email) === email);

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return json(res, 401, { ok: false, error: "invalid_credentials" });
    }

    const session = makeSession(user.id);
    user.lastLoginAt = new Date().toISOString();
    saveAuthData();

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
    );

    return json(res, 200, {
      ok: true,
      user: publicUser(user),
      access: accountAccessState(user)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) clearSessionToken(token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = sessionUser(req);
    return json(res, 200, {
      ok: true,
      user: publicUser(user),
      access: accountAccessState(user)
    });
  }


  if (req.method === "GET" && url.pathname === "/api/store") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;
    return json(res, 200, {
      ok: true,
      store: {
        configured: Boolean(user.storeConfigured),
        name: user.storeName || "",
        cnpj: user.cnpj || "",
        phone: user.storePhone || "",
        address: user.storeAddress || "",
        number: user.storeNumber || "",
        complement: user.storeComplement || "",
        neighborhood: user.storeNeighborhood || "",
        city: user.storeCity || "",
        state: user.storeState || "",
        zipCode: user.storeZipCode || "",
        contactName: user.storeContactName || user.name || "",
        contactPhone: user.storeContactPhone || ""
      }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/store") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { ok: false, error: "store_name_required" });

    user.storeName = name;
    user.cnpj = String(body.cnpj || "").trim();
    user.storePhone = String(body.phone || "").trim();
    user.storeAddress = String(body.address || "").trim();
    user.storeNumber = String(body.number || "").trim();
    user.storeComplement = String(body.complement || "").trim();
    user.storeNeighborhood = String(body.neighborhood || "").trim();
    user.storeCity = String(body.city || "").trim();
    user.storeState = String(body.state || "").trim().toUpperCase();
    user.storeZipCode = String(body.zipCode || "").trim();
    user.storeContactName = String(body.contactName || user.name || "").trim();
    user.storeContactPhone = String(body.contactPhone || "").trim();
    user.storeConfigured = true;
    user.updatedAt = new Date().toISOString();
    saveAuthData();

    return json(res, 200, { ok: true, user: publicUser(user) });
  }


  // ===== iFood por cliente / loja =====
  // O Client ID e Client Secret continuam apenas no servidor.
  // Cada usuário mantém somente a autorização/merchant da própria loja.
  if (req.method === "GET" && url.pathname === "/api/integrations/ifood") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;
    try { await restoreIfoodIntegration(user); }
    catch (e) { log("supabase", `Falha ao restaurar integração iFood: ${e.message}`); }
    const cid = productionIfoodClientId();
    return json(res, 200, {
      ok: true,
      integration: ifoodCustomerConnection(user),
      appConfigured: Boolean(cid && productionIfoodClientSecret()),
      credentialDiagnostic: {
        clientIdConfigured: Boolean(cid),
        clientIdLength: cid.length,
        clientIdUuidFormat: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cid),
        clientSecretConfigured: Boolean(productionIfoodClientSecret())
      }
    });
  }


  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/request") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;
    const body = await readJson(req);
    const identifier = String(body.identifier || "").trim();
    if (!identifier) {
      return json(res, 400, { ok: false, error: "identifier_required" });
    }

    user.ifoodLinkStatus = "requested";
    user.ifoodRequestedIdentifier = identifier;
    user.ifoodRequestedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    saveAuthData();

    return json(res, 200, {
      ok: true,
      integration: ifoodCustomerConnection(user)
    });
  }


  // ===== iFood distribuído: conexão self-service por código =====
  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/code/start") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;

    if (!productionIfoodClientId()) {
      return json(res, 503, {
        ok: false,
        error: "ifood_client_id_not_configured",
        message: "IFOOD_CLIENT_ID não está configurado no servidor."
      });
    }

    try {
      // O endpoint oficial exige apenas clientId para gerar o userCode.
      const payload = await ifoodAuthForm("/oauth/userCode", {
        clientId: productionIfoodClientId()
      });

      const userCode = String(payload.userCode || "").trim();
      const verifier = String(payload.authorizationCodeVerifier || "").trim();
      const verificationUrl = String(
        payload.verificationUrlComplete ||
        payload.verificationUrl ||
        "https://portal.ifood.com.br/apps"
      ).trim();

      if (!userCode || !verifier) {
        return json(res, 502, {
          ok: false,
          error: "ifood_invalid_user_code_response",
          details: payload
        });
      }

      // Documentação atual: userCode normalmente vale 10 minutos.
      const expiresIn = Math.max(60, Number(payload.expiresIn || 600));

      user.ifoodAuthMode = "distributed";
      user.ifoodLinkStatus = "code_generated";
      user.ifoodUserCode = userCode;
      user.ifoodAuthorizationCodeVerifier = verifier;
      user.ifoodVerificationUrl = verificationUrl;
      user.ifoodCodeExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      user.updatedAt = new Date().toISOString();
      saveAuthData();

      return json(res, 200, {
        ok: true,
        userCode,
        verificationUrl,
        expiresAt: user.ifoodCodeExpiresAt
      });
    } catch (err) {
      log("ifood-auth", `Falha ao gerar código de vínculo: ${err.message}`);

      const rawMessage = String(err.message || "");
      const grantNotAllowed = /grant type not authorized for client/i.test(rawMessage);
      const invalidClientId = /clientid is invalid/i.test(rawMessage);
      const configuredClientId = productionIfoodClientId();
      const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuredClientId);

      if (invalidClientId) {
        log("ifood-auth", `clientId rejeitado pelo iFood; comprimento=${configuredClientId.length}; formatoUUID=${uuidLike ? "SIM" : "NÃO"}`);
        return json(res, 400, {
          ok: false,
          error: "ifood_client_id_invalid",
          message: "O iFood rejeitou o Client ID. A v6.2 já remove espaços, aspas e quebras ocultas automaticamente. Confira se o IFOOD_CLIENT_ID é o da credencial do aplicativo TurboFlow Distribuído aprovado.",
          diagnostic: {
            clientIdLength: configuredClientId.length,
            uuidFormat: uuidLike
          }
        });
      }

      if (grantNotAllowed) {
        return json(res, 409, {
          ok: false,
          error: "ifood_app_not_distributed",
          message: "O aplicativo iFood configurado no TurboFlow ainda está como Centralizado. Para usar a ativação automática por código, configure no Portal do Desenvolvedor um aplicativo do tipo Distribuído e depois atualize o IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET no servidor."
        });
      }

      return json(res, 502, {
        ok: false,
        error: "ifood_user_code_failed",
        message: rawMessage || "Não foi possível gerar o código de ativação."
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/code/complete") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;

    const body = await readJson(req);
    const authorizationCode = String(body.authorizationCode || "").trim().toUpperCase();

    if (!authorizationCode) {
      return json(res, 400, { ok: false, error: "authorization_code_required" });
    }
    if (!user.ifoodAuthorizationCodeVerifier) {
      return json(res, 409, {
        ok: false,
        error: "link_code_not_started",
        message: "Gere um novo código de vínculo antes de concluir a conexão."
      });
    }
    if (user.ifoodCodeExpiresAt && new Date(user.ifoodCodeExpiresAt).getTime() <= Date.now()) {
      return json(res, 409, {
        ok: false,
        error: "link_code_expired",
        message: "O código de vínculo expirou. Gere um novo código."
      });
    }

    try {
      const tokenPayload = await ifoodAuthForm("/oauth/token", {
        grantType: "authorization_code",
        clientId: productionIfoodClientId(),
        clientSecret: productionIfoodClientSecret(),
        authorizationCode,
        authorizationCodeVerifier: user.ifoodAuthorizationCodeVerifier
      });

      const accessToken = String(tokenPayload.accessToken || tokenPayload.access_token || "");
      const refreshToken = String(tokenPayload.refreshToken || tokenPayload.refresh_token || "");
      const expiresIn = Math.max(60, Number(tokenPayload.expiresIn || 0));

      if (!accessToken) {
        return json(res, 502, {
          ok: false,
          error: "ifood_token_missing"
        });
      }

      user.ifoodAccessToken = accessToken;
      user.ifoodRefreshToken = refreshToken;
      user.ifoodTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Descobre automaticamente a loja autorizada com o token do próprio cliente.
      const merchants = await listUserIfoodMerchants(user);

      if (!merchants.length) {
        // Mantemos tokens para permitir nova verificação durante a propagação.
        user.ifoodLinkStatus = "authorized_waiting_merchant";
        user.ifoodConnected = false;
        user.updatedAt = new Date().toISOString();
        saveAuthData();
        try { await saveIfoodIntegration(user); }
        catch (e) { log("supabase", `Falha ao salvar autorização pendente: ${e.message}`); }

        return json(res, 202, {
          ok: true,
          connected: false,
          waiting: true,
          message: "Autorização recebida. Aguardando a loja aparecer na API do iFood."
        });
      }

      // Para 1 conta = 1 loja, normalmente haverá um merchant autorizado.
      // Se houver mais de um, frontend pede a seleção.
      if (merchants.length > 1 && !body.merchantId) {
        user.ifoodLinkStatus = "select_merchant";
        user.updatedAt = new Date().toISOString();
        saveAuthData();
        return json(res, 200, {
          ok: true,
          connected: false,
          selectMerchant: true,
          merchants: merchants.map(m => ({
            id: String(m?.id || ""),
            name: String(m?.name || "")
          })).filter(m => m.id)
        });
      }

      const selectedId = String(body.merchantId || merchants[0]?.id || "").trim();
      const selected = merchants.find(m => String(m?.id || "") === selectedId) || merchants[0];

      user.ifoodConnected = true;
      user.ifoodLinkStatus = "connected";
      user.ifoodMerchantId = String(selected?.id || selectedId);
      user.ifoodMerchantName = String(selected?.name || user.storeName || "");
      user.ifoodConnectedAt = new Date().toISOString();

      // Não precisamos mais guardar os códigos temporários.
      user.ifoodUserCode = "";
      user.ifoodAuthorizationCodeVerifier = "";
      user.ifoodVerificationUrl = "";
      user.ifoodCodeExpiresAt = null;
      user.updatedAt = new Date().toISOString();
      saveAuthData();
      try { await saveIfoodIntegration(user); }
      catch (e) { log("supabase", `Falha ao persistir loja conectada: ${e.message}`); }

      return json(res, 200, {
        ok: true,
        connected: true,
        integration: ifoodCustomerConnection(user)
      });
    } catch (err) {
      log("ifood-auth", `Falha ao concluir código de autorização: ${err.message}`);
      return json(res, 502, {
        ok: false,
        error: "ifood_authorization_failed",
        message: err.message
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/code/check") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;

    try { await restoreIfoodIntegration(user); }
    catch (e) { log("supabase", `Falha ao restaurar autorização pendente: ${e.message}`); }

    if (!user.ifoodAccessToken) {
      return json(res, 409, { ok: false, error: "authorization_not_completed" });
    }

    try {
      const checkBody = await readJson(req);
      const manualMerchantId = String(checkBody.merchantId || "").trim();

      // Fallback para aplicativos distribuídos em que GET /merchants pode
      // temporariamente retornar [] mesmo com a permissão ativa no portal.
      // O ID informado pelo lojista só é aceito se o próprio token autorizado
      // conseguir consultar GET /merchants/{merchantId}.
      if (manualMerchantId) {
        const direct = await ifoodUserRequest(
          user,
          `/merchant/v1.0/merchants/${encodeURIComponent(manualMerchantId)}`
        );
        const merchant = direct.data || {};
        const returnedId = String(merchant?.id || manualMerchantId).trim();
        if (returnedId !== manualMerchantId) {
          return json(res, 409, {
            ok: false,
            error: "merchant_id_mismatch",
            message: "O iFood respondeu com uma loja diferente do ID informado."
          });
        }

        user.ifoodConnected = true;
        user.ifoodLinkStatus = "connected";
        user.ifoodMerchantId = manualMerchantId;
        user.ifoodMerchantName = String(merchant?.name || merchant?.corporateName || user.storeName || "Loja iFood");
        user.ifoodConnectedAt = new Date().toISOString();
        user.updatedAt = new Date().toISOString();
        saveAuthData();
        try { await saveIfoodIntegration(user); }
        catch (e) { log("supabase", `Falha ao persistir merchant validado: ${e.message}`); }

        log("ifood-auth", `Merchant validado diretamente: HTTP ${direct.status} | id=${manualMerchantId}`);
        return json(res, 200, {
          ok: true,
          connected: true,
          integration: ifoodCustomerConnection(user),
          diagnostic: {
            token: "OK",
            endpoint: `/merchant/v1.0/merchants/${manualMerchantId}`,
            httpStatus: direct.status,
            selectedMerchantId: manualMerchantId,
            selectedMerchantName: user.ifoodMerchantName
          }
        });
      }

      const merchantResult = await inspectUserIfoodMerchants(user);
      const merchants = merchantResult.merchants;
      log("ifood-auth", `Verificação merchant: HTTP ${merchantResult.diagnostic.httpStatus} | lojas=${merchants.length} | formato=${merchantResult.diagnostic.responseShape}`);
      if (!merchants.length) {
        return json(res, 200, {
          ok: true,
          connected: false,
          waiting: true,
          manualMerchantIdAllowed: true,
          diagnostic: merchantResult.diagnostic,
          message: `Token OK | GET /merchant/v1.0/merchants: HTTP ${merchantResult.diagnostic.httpStatus} | Lojas encontradas: 0`
        });
      }

      const selected = merchants[0];
      user.ifoodConnected = true;
      user.ifoodLinkStatus = "connected";
      user.ifoodMerchantId = String(selected?.id || "");
      user.ifoodMerchantName = String(selected?.name || user.storeName || "");
      user.ifoodConnectedAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
      saveAuthData();
      try { await saveIfoodIntegration(user); }
      catch (e) { log("supabase", `Falha ao persistir merchant encontrado: ${e.message}`); }

      return json(res, 200, {
        ok: true,
        connected: true,
        integration: ifoodCustomerConnection(user),
        diagnostic: {
          ...merchantResult.diagnostic,
          selectedMerchantId: user.ifoodMerchantId,
          selectedMerchantName: user.ifoodMerchantName
        }
      });
    } catch (err) {
      log("ifood-auth", `Erro ao verificar merchant: HTTP ${err.status || "?"} | ${err.message}`);
      return json(res, 502, {
        ok: false,
        error: "ifood_check_failed",
        message: err.message,
        diagnostic: {
          token: user.ifoodAccessToken ? "PRESENTE" : "AUSENTE",
          endpoint: "/merchant/v1.0/merchants",
          httpStatus: err.status || null,
          ifoodResponse: err.payload || null
        }
      });
    }
  }


  // v2.11 — solicitação iFood pelo ID da loja (fluxo centralizado)
  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/merchant-request") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;

    const body = await readJson(req);
    const merchantId = String(body.merchantId || "").trim();

    if (!merchantId) {
      return json(res, 400, {
        ok: false,
        error: "merchant_id_required",
        message: "Informe o ID da sua loja no iFood."
      });
    }

    user.ifoodRequestedMerchantId = merchantId;
    user.ifoodRequestedIdentifier = merchantId;
    user.ifoodLinkStatus = "requested";
    user.ifoodRequestedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    saveAuthData();

    return json(res, 200, {
      ok: true,
      message: "Solicitação recebida.",
      integration: ifoodCustomerConnection(user)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/disconnect") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;
    clearIfoodCustomerConnection(user);
    try { await clearIfoodIntegrationFromSupabase(user); }
    catch (e) { log("supabase", `Falha ao limpar integração iFood: ${e.message}`); }
    return json(res, 200, { ok: true, integration: ifoodCustomerConnection(user) });
  }

  // Salva o merchant depois que o fluxo oficial de autorização iFood retornar.
  // Tokens nunca são enviados para o frontend.
  if (req.method === "POST" && url.pathname === "/api/integrations/ifood/complete") {
    const user = requireActiveCustomer(req, res);
    if (!user) return;
    const body = await readJson(req);
    const merchantId = String(body.merchantId || "").trim();
    const merchantName = String(body.merchantName || user.storeName || "").trim();
    if (!merchantId) return json(res, 400, { ok: false, error: "merchant_id_required" });

    user.ifoodConnected = true;
    user.ifoodLinkStatus = "connected";
    user.ifoodMerchantId = merchantId;
    user.ifoodMerchantName = merchantName;
    user.ifoodConnectedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    saveAuthData();
    try { await saveIfoodIntegration(user); }
    catch (e) { log("supabase", `Falha ao persistir integração manual: ${e.message}`); }
    return json(res, 200, { ok: true, integration: ifoodCustomerConnection(user) });
  }


  const adminIfoodLinkMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/ifood$/);
  if (req.method === "POST" && adminIfoodLinkMatch) {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const userId = decodeURIComponent(adminIfoodLinkMatch[1]);
    const user = authData.users.find(u => u.id === userId && u.role !== "admin");
    if (!user) return json(res, 404, { ok: false, error: "user_not_found" });

    const body = await readJson(req);
    const action = String(body.action || "link");

    if (action === "disconnect") {
      clearIfoodCustomerConnection(user);
      return json(res, 200, { ok: true, user: publicUser(user) });
    }

    const merchantId = String(body.merchantId || "").trim();
    if (!merchantId) {
      return json(res, 400, { ok: false, error: "merchant_id_required" });
    }

    let merchants;
    try {
      merchants = await listAccessibleIfoodMerchants();
    } catch (err) {
      return json(res, 502, {
        ok: false,
        error: "ifood_merchant_check_failed",
        message: err.message
      });
    }

    const merchant = merchants.find(m => String(m?.id || "") === merchantId);
    if (!merchant) {
      return json(res, 409, {
        ok: false,
        error: "merchant_not_authorized",
        message: "Este merchant ainda não aparece entre as lojas autorizadas para o aplicativo TurboFlow."
      });
    }

    // Evita associar a mesma loja a dois clientes.
    const alreadyLinked = authData.users.find(
      u => u.id !== user.id &&
           u.role !== "admin" &&
           u.ifoodConnected &&
           String(u.ifoodMerchantId || "") === merchantId
    );
    if (alreadyLinked) {
      return json(res, 409, {
        ok: false,
        error: "merchant_already_linked",
        message: "Este merchant já está vinculado a outro cliente."
      });
    }

    user.ifoodConnected = true;
    user.ifoodLinkStatus = "connected";
    user.ifoodMerchantId = merchantId;
    user.ifoodMerchantName = String(merchant?.name || body.merchantName || user.storeName || "").trim();
    user.ifoodConnectedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    saveAuthData();

    return json(res, 200, {
      ok: true,
      merchant: { id: merchantId, name: user.ifoodMerchantName },
      user: publicUser(user)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return json(res, 200, {
      ok: true,
      users: authData.users
        .filter(u => u.role !== "admin")
        .map(publicUser)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  }


  const adminDeleteUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === "DELETE" && adminDeleteUserMatch) {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const userId = decodeURIComponent(adminDeleteUserMatch[1]);
    const user = authData.users.find(u => u.id === userId && u.role !== "admin");
    if (!user) return json(res, 404, { ok: false, error: "user_not_found" });

    // Remove também sessões ligadas ao cliente.
    authData.sessions = authData.sessions.filter(s => s.userId !== userId);
    authData.users = authData.users.filter(u => u.id !== userId);
    saveAuthData();

    return json(res, 200, { ok: true, deletedUserId: userId });
  }

  const adminPlanMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/plan$/);
  if (req.method === "POST" && adminPlanMatch) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const userId = decodeURIComponent(adminPlanMatch[1]);
    const user = authData.users.find(u => u.id === userId && u.role !== "admin");
    if (!user) return json(res, 404, { ok: false, error: "user_not_found" });

    const action = String(body.action || "activate");
    if (action === "block") {
      user.status = "blocked";
      user.updatedAt = new Date().toISOString();
      saveAuthData();
    } else if (action === "pending") {
      user.status = "pending";
      user.updatedAt = new Date().toISOString();
      saveAuthData();
    } else {
      addPlanDays(user, Number(body.days || 30), Boolean(body.resetFromNow));
    }

    return json(res, 200, { ok: true, user: publicUser(user) });
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === "GET" && adminUserMatch) {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const user = authData.users.find(u => u.id === decodeURIComponent(adminUserMatch[1]));
    if (!user) return json(res, 404, { ok: false, error: "user_not_found" });
    return json(res, 200, { ok: true, user: publicUser(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, {
      configured: Boolean(productionIfoodClientId() && productionIfoodClientSecret()),
      polling: isPolling,
      autoConfirm: settings.autoConfirm,
      autoStartPreparation: settings.autoStartPreparation,
      autoReady: settings.autoReady,
      acceptDelaySeconds: settings.acceptDelaySeconds,
      readyDelaySeconds: settings.readyDelaySeconds,
      printSettings: settings.printSettings,
      pollIntervalMs: POLL_INTERVAL_MS,
      transport: "polling",
      webhook99FoodPath: "/webhook/99food"
    });
  }


  if (req.method === "GET" && url.pathname === "/api/settings") {
    return json(res, 200, settings);
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readJsonBody(req);
    const acceptDelay = Math.max(0, Math.min(3600, Number(body.acceptDelaySeconds ?? settings.acceptDelaySeconds ?? 5)));
    const readyDelay = Math.max(0, Math.min(3600, Number(body.readyDelaySeconds ?? settings.readyDelaySeconds ?? 10)));

    const next = saveSettings({
      autoConfirm: Boolean(body.autoConfirm),
      autoStartPreparation: Boolean(body.autoStartPreparation),
      autoReady: Boolean(body.autoReady),
      acceptDelaySeconds: acceptDelay,
      readyDelaySeconds: readyDelay
    });

    settings = { ...settings, ...next };

    log("settings", `Configurações: aceite ${next.acceptDelaySeconds}s, pronto ${next.readyDelaySeconds}s.`);
    return json(res, 200, next);
  }

  
  if (req.method === "GET" && url.pathname === "/api/print-settings") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    return json(res, 200, settings.printSettings || {});
  }

  if (req.method === "POST" && url.pathname === "/api/print-settings") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    const body = await readJson(req);
    const nextPrint = {
      paperWidth: ["58","80"].includes(String(body.paperWidth)) ? String(body.paperWidth) : "80",
      fontSize: Math.max(8, Math.min(30, Number(body.fontSize || 12))),
      companyFontSize: Math.max(12, Math.min(48, Number(body.companyFontSize || 28))),
      companyFontSize: Math.max(12, Math.min(48, Number(body.companyFontSize || 28))),
      showCnpj: body.showCnpj === true,
      showCategories: Boolean(body.showCategories),
      showDescription: Boolean(body.showDescription),
      showAddonGroupTitle: Boolean(body.showAddonGroupTitle),
      showCustomer: Boolean(body.showCustomer),
      showAddress: Boolean(body.showAddress),
      showPayment: Boolean(body.showPayment),
      showTotal: body.showTotal !== false,
      showOrderId: Boolean(body.showOrderId),
      showPhone: Boolean(body.showPhone),
      groupIdentical: ["keep","multiply","separate"].includes(String(body.groupIdentical)) ? String(body.groupIdentical) : "separate",
      useAssistant: Boolean(body.useAssistant),
      autoPrint: Boolean(body.autoPrint),
      selectedPrinter: String(body.selectedPrinter || ""),
      copies: Math.max(1, Math.min(5, Number(body.copies || 1)))
    };
    settings.printSettings = nextPrint;
    saveSettings(settings);
    log("settings", `Configuração de impressão atualizada: ${nextPrint.paperWidth}mm, fonte ${nextPrint.fontSize}px, empresa ${nextPrint.companyFontSize}px.`);
    return json(res, 200, nextPrint);
  }

  
  // ===== Contexto do Portal de Pedidos =====
  // Em homologação, usa a autorização HML já aprovada no Wizard.
  // Em produção, cada cliente continua usando a própria conexão iFood.
  if (req.method === "GET" && url.pathname === "/api/orders/context") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    if (activeUser && activeUser.role !== "admin") {
      try { await restoreIfoodIntegration(activeUser); }
      catch (e) { log("supabase", `Falha ao restaurar integração no KDS: ${e.message}`); }
    }

    const hmlMode = homologationModeEnabled();
    const hmlAuthorized = Boolean(
      hmlMode &&
      hmlAuth &&
      (hmlAuth.accessToken || hmlAuth.refreshToken)
    );

    return json(res, 200, {
      ok: true,
      mode: hmlMode ? "homologation" : "production",
      authorized: hmlMode
        ? hmlAuthorized
        : Boolean(activeUser.ifoodConnected && activeUser.ifoodMerchantId),
      merchantId: hmlMode
        ? (homologationMerchantIds()[0] || "")
        : (activeUser.ifoodMerchantId || ""),
      merchantName: hmlMode
        ? "Loja de teste iFood"
        : (activeUser.ifoodMerchantName || ""),
      canImportHomologationOrder: Boolean(hmlMode && activeUser.role === "admin")
    });
  }

  // O Render reinicia a memória a cada deploy. Durante a homologação, o iFood
  // informa o UUID exato do pedido da etapa. O admin pode recarregar esse pedido
  // diretamente pela Order API HML para continuar o teste sem gerar outro pedido.
  if (req.method === "POST" && url.pathname === "/api/orders/hml-import") {
    const admin = requireAdmin(req, res); if (!admin) return;

    if (!homologationModeEnabled()) {
      return json(res, 409, {
        ok: false,
        error: "homologation_mode_disabled",
        message: "Importação manual só é permitida no modo de homologação."
      });
    }

    if (!(hmlAuth && (hmlAuth.accessToken || hmlAuth.refreshToken))) {
      return json(res, 409, {
        ok: false,
        error: "homologation_not_authorized",
        message: "Autorize primeiro a loja de teste na tela de Homologação iFood."
      });
    }

    const body = await readJson(req);
    const orderId = String(body.orderId || "").trim();

    if (!orderId) {
      return json(res, 400, {
        ok: false,
        error: "order_id_required",
        message: "Informe o UUID do pedido mostrado pelo iFood Developer."
      });
    }

    try {
      // getOrderDetail() usa ifoodRequest(); em modo HML ele é direcionado
      // automaticamente para hmlIfoodRequest().
      const detail = await getOrderDetail(orderId);
      const normalized = normalizeOrder(detail);

      normalized.id = normalized.id || orderId;
      normalized.status = normalized.status || detail?.status || "PLACED";
      normalized.updatedAt = new Date().toISOString();

      // Se o iFood não devolver displayId, permite usar o número visual só
      // para facilitar a identificação na interface.
      const displayId = String(body.displayId || "").trim();
      if (displayId && (!normalized.displayId || normalized.displayId === orderId.slice(0, 8))) {
        normalized.displayId = displayId;
      }

      orders.set(orderId, normalized);
      log("hml-import", `Pedido de homologação ${normalized.displayId || orderId} carregado no Portal da Loja.`);

      return json(res, 200, {
        ok: true,
        order: normalized
      });
    } catch (err) {
      log("hml-import-error", `Falha ao carregar pedido ${orderId}: ${err.message}`);
      return json(res, 502, {
        ok: false,
        error: "hml_order_import_failed",
        message: err.message
      });
    }
  }

if (req.method === "GET" && url.pathname === "/api/orders") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    const visibleOrders = [...orders.values()]
      .filter(order => userCanAccessOrder(activeUser, order))
      .sort((a,b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0));
    return json(res, 200, visibleOrders);
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    return json(res, 200, eventsLog);
  }

  if (req.method === "POST" && url.pathname === "/api/poll") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    await pollEvents();
    return json(res, 200, { ok: true });
  }


  // ===== Cancelamento iFood =====
  // Os motivos são SEMPRE consultados dinamicamente no iFood para o pedido específico.
  const cancellationReasonsMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancellation-reasons$/);
  if (req.method === "GET" && cancellationReasonsMatch) {
    const id = decodeURIComponent(cancellationReasonsMatch[1]);
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    const order = orders.get(id);
    if (!order) return json(res, 404, { ok: false, error: "order_not_found" });
    if (!userCanAccessOrder(activeUser, order)) {
      return json(res, 403, { ok: false, error: "order_not_owned_by_store" });
    }

    try {
      const { data, status } = await ifoodRequestForUser(activeUser, `/order/v1.0/orders/${encodeURIComponent(id)}/cancellationReasons`);

      // Diagnóstico v5.2:
      // Guarda o retorno bruto para podermos ver exatamente o formato que o iFood HML enviou.
      const rawType = Array.isArray(data) ? "array" : typeof data;

      // Aceita vários formatos possíveis sem "inventar" motivos.
      let reasons = [];
      if (Array.isArray(data)) reasons = data;
      else if (Array.isArray(data?.reasons)) reasons = data.reasons;
      else if (Array.isArray(data?.cancellationReasons)) reasons = data.cancellationReasons;
      else if (Array.isArray(data?.data)) reasons = data.data;
      else if (Array.isArray(data?.items)) reasons = data.items;

      const normalized = reasons
        .map(r => ({
          code: String(
            r?.cancelCodeId ??
            r?.code ??
            r?.id ??
            r?.cancellationCode ??
            r?.reasonCode ??
            ""
          ).trim(),
          description: String(
            r?.description ??
            r?.name ??
            r?.reason ??
            r?.message ??
            r?.title ??
            ""
          ).trim()
        }))
        .filter(r => r.code);

      log(
        "cancel-diagnostic",
        `Motivos cancelamento ${id}: HTTP ${status}; tipo=${rawType}; normalizados=${normalized.length}; raw=${JSON.stringify(data)}`
      );

      return json(res, 200, {
        ok: true,
        reasons: normalized,
        diagnostic: {
          endpoint: `/order/v1.0/orders/${id}/cancellationReasons`,
          httpStatus: status,
          rawType,
          raw: data
        }
      });
    } catch (err) {
      log("cancel-error", `Falha ao consultar motivos de ${id}: ${err.message}`);
      return json(res, 502, {
        ok: false,
        error: "cancellation_reasons_failed",
        message: err.message,
        diagnostic: {
          endpoint: `/order/v1.0/orders/${id}/cancellationReasons`
        }
      });
    }
  }

  const cancelOrderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancelOrderMatch) {
    const id = decodeURIComponent(cancelOrderMatch[1]);
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    const order = orders.get(id);
    if (!order) return json(res, 404, { ok: false, error: "order_not_found" });
    if (!userCanAccessOrder(activeUser, order)) {
      return json(res, 403, { ok: false, error: "order_not_owned_by_store" });
    }

    const body = await readJson(req);
    const reason = String(body.reason || "").trim();
    if (!reason) return json(res, 400, { ok: false, error: "reason_required" });

    try {
      // Confirma no iFood que o motivo ainda é válido para ESTE pedido.
      const { data: reasonsData } = await ifoodRequestForUser(activeUser, `/order/v1.0/orders/${encodeURIComponent(id)}/cancellationReasons`);

      let reasons = [];
      if (Array.isArray(reasonsData)) reasons = reasonsData;
      else if (Array.isArray(reasonsData?.reasons)) reasons = reasonsData.reasons;
      else if (Array.isArray(reasonsData?.cancellationReasons)) reasons = reasonsData.cancellationReasons;
      else if (Array.isArray(reasonsData?.data)) reasons = reasonsData.data;
      else if (Array.isArray(reasonsData?.items)) reasons = reasonsData.items;

      const valid = reasons.some(r =>
        String(
          r?.cancelCodeId ??
          r?.code ??
          r?.id ??
          r?.cancellationCode ??
          r?.reasonCode ??
          ""
        ).trim() === reason
      );
      if (!valid) {
        return json(res, 409, {
          ok: false,
          error: "invalid_cancellation_reason",
          message: "Esse motivo não está mais disponível para este pedido. Atualize a lista."
        });
      }

      const { data, status } = await ifoodRequestForUser(activeUser, `/order/v1.0/orders/${encodeURIComponent(id)}/requestCancellation`, {
        method: "POST",
        body: JSON.stringify({ cancellationCode: reason })
      });

      const current = orders.get(id) || { id };
      current.status = "CANCELLATION_REQUESTED";
      current.stage = "CANCELLATION";
      current.cancellationReason = reason;
      current.updatedAt = new Date().toISOString();
      orders.set(id, current);

      log("cancel", `Cancelamento solicitado para ${id} com cancellationCode=${reason}.`);
      return json(res, 202, { ok: true, accepted: true, status, data, order: current });
    } catch (err) {
      log("cancel-error", `Falha ao cancelar ${id}: ${err.message}`);
      return json(res, 502, { ok: false, error: "cancellation_failed", message: err.message });
    }
  }

  const actionMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/(confirm|start|ready|dispatch)$/);
  if (req.method === "POST" && actionMatch) {
    const id = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    const order = orders.get(id);
    if (!order) return json(res, 404, { ok: false, error: "order_not_found" });
    if (!userCanAccessOrder(activeUser, order)) {
      return json(res, 403, { ok: false, error: "order_not_owned_by_store" });
    }
    let result;
    if (action === "confirm") result = await actionConfirm(id, activeUser || ownerForOrder(orders.get(id)));
    if (action === "start") result = await actionStartPreparation(id, activeUser);
    if (action === "ready") result = await actionReadyToPickup(id, activeUser || ownerForOrder(orders.get(id)));
    if (action === "dispatch") result = await actionDispatch(id, activeUser);
    return json(res, 200, { ok: true, order: result });
  }


  if (req.method === "GET" && url.pathname === "/api/ifood/homologation-status") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return json(res, 200, {
      ok: true,
      pollingMerchants: homologationMerchantIds(),
      pollingIntervalSeconds: 30,
      clientIdConfigured: Boolean(productionIfoodClientId()),
      clientSecretConfigured: Boolean(productionIfoodClientSecret())
    });
  }


  // ===== Homologação iFood - aplicativo distribuído de TESTE =====
  if (req.method === "GET" && url.pathname === "/api/admin/ifood-hml/merchant-status") {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const merchantIds = homologationMerchantIds();
    if (!merchantIds.length) {
      return json(res, 409, { ok: false, message: "IFOOD_POLLING_MERCHANTS não configurado." });
    }
    if (!hmlAuth.accessToken && !hmlAuth.refreshToken) {
      return json(res, 409, { ok: false, message: "Homologação ainda não autorizada." });
    }

    try {
      const results = [];
      for (const merchantId of merchantIds) {
        const { data } = await hmlIfoodRequest(`/merchant/v1.0/merchants/${encodeURIComponent(merchantId)}/status`);
        const rows = Array.isArray(data) ? data : [data].filter(Boolean);
        const validations = rows.flatMap(row => Array.isArray(row?.validations) ? row.validations : []);
        const connected = validations.find(v => {
          const code = String(v?.code || "").toLowerCase();
          return code === "is-connected" || code === "is.connected.config";
        });
        results.push({
          merchantId,
          connectedState: connected?.state || "NÃO INFORMADO",
          available: rows.some(row => row?.available === true),
          states: rows.map(row => row?.state).filter(Boolean),
          validations,
          raw: data,
          debug: JSON.stringify(data)
        });
      }
      return json(res, 200, { ok: true, results });
    } catch (err) {
      log("hml-merchant-status-error", err.message);
      return json(res, 502, { ok: false, message: err.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/ifood-hml/status") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    return json(res, 200, {
      ok: true,
      clientIdConfigured: Boolean(hmlClientId()),
      clientSecretConfigured: Boolean(hmlClientSecret()),
      authorized: Boolean(hmlAuth.accessToken || hmlAuth.refreshToken),
      tokenValid: hmlTokenValid(),
      userCode: hmlAuth.userCode || "",
      verificationUrl: hmlAuth.verificationUrl || "",
      pollingMerchants: homologationMerchantIds()
    });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/ifood-hml/start") {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    if (!hmlClientId()) {
      return json(res, 409, {
        ok: false,
        error: "hml_client_id_missing",
        message: "Adicione IFOOD_HML_CLIENT_ID no Render com o Client ID do aplicativo de teste Distribuído."
      });
    }

    try {
      const payload = await hmlAuthForm("/oauth/userCode", { clientId: hmlClientId() });
      hmlAuth.userCode = payload.userCode || "";
      hmlAuth.authorizationCodeVerifier = payload.authorizationCodeVerifier || "";
      hmlAuth.verificationUrl = payload.verificationUrlComplete || payload.verificationUrl || "https://portal.ifood.com.br/apps/code";
      hmlAuth.userCodeExpiresAt = Date.now() + Number(payload.expiresIn || 600) * 1000;
      saveHmlAuth(hmlAuth);

      return json(res, 200, {
        ok: true,
        userCode: hmlAuth.userCode,
        verificationUrl: hmlAuth.verificationUrl
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: "hml_user_code_failed", message: err.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/ifood-hml/complete") {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const body = await readJson(req);
    const authorizationCode = String(body.authorizationCode || "").trim();

    if (!authorizationCode || !hmlAuth.authorizationCodeVerifier) {
      return json(res, 400, { ok: false, message: "Gere o código primeiro e informe o authorizationCode." });
    }
    if (!hmlClientSecret()) {
      return json(res, 409, {
        ok: false,
        error: "hml_client_secret_missing",
        message: "Adicione IFOOD_HML_CLIENT_SECRET no Render."
      });
    }

    try {
      const payload = await hmlAuthForm("/oauth/token", {
        grantType: "authorization_code",
        clientId: hmlClientId(),
        clientSecret: hmlClientSecret(),
        authorizationCode,
        authorizationCodeVerifier: hmlAuth.authorizationCodeVerifier
      });

      hmlAuth.accessToken = payload.accessToken || payload.access_token || "";
      hmlAuth.refreshToken = payload.refreshToken || payload.refresh_token || "";
      const expiresIn = Number(payload.expiresIn || payload.expires_in || 21600);
      hmlAuth.expiresAt = Date.now() + expiresIn * 1000;
      hmlAuth.authorizedAt = new Date().toISOString();
      hmlAuth.userCode = "";
      hmlAuth.authorizationCodeVerifier = "";
      saveHmlAuth(hmlAuth);

      return json(res, 200, { ok: true, authorized: true });
    } catch (err) {
      return json(res, 502, { ok: false, error: "hml_token_failed", message: err.message });
    }
  }

  return json(res, 404, { error: "Rota não encontrada" });
}


function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (err) { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function serveStatic(req, res, url) {
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const publicRoot = path.join(__dirname, "public");
  const full = path.normalize(path.join(publicRoot, file));
  if (!full.startsWith(publicRoot)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); return res.end("Not found");
  }
  const ext = path.extname(full);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && url.pathname === "/webhook/99food") {
      return await handle99FoodWebhook(req, res);
    }

    if (req.method === "GET" && url.pathname === "/webhook/99food") {
      return json(res, 200, {
        ok: true,
        service: "TurboFlow",
        webhook: "/webhook/99food",
        status: "ready"
      });
    }

    if (req.method === "GET" && url.pathname === "/webhook/99food/health") {
      return json(res, 200, {
        ok: true,
        service: "TurboFlow",
        webhook: "/webhook/99food",
        status: "ready"
      });
    }
if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    log("error", err.message);
    return json(res, 500, { error: err.message });
  }
});


server.listen(PORT, () => {
  console.log("=== iFood EVENT MODE: POLLING ONLY ===");
  console.log("iFood: POLLING ONLY (webhook removido)");
  console.log("Polling iFood/HML: ATIVO a cada 30s");
  if (homologationModeEnabled()) {
    console.log("=== MODO HOMOLOGAÇÃO iFood ATIVO ===");
    console.log("Teste (C): DESATIVADO");
    console.log("Teste (D): Authorization Code + polling 30s");
    console.log("Heartbeat HML: modo CLIENT (sem x-polling-merchants durante conectividade)");
  }
  console.log(`TurboFlow: http://localhost:${PORT}`);
  console.log(`Webhook 99Food: http://localhost:${PORT}/webhook/99food`);
  console.log(`Polling de contingência a cada ${Math.round(POLL_INTERVAL_MS / 60000)} min`);
  if (hmlAuth.accessToken || hmlAuth.refreshToken) {
    console.log("Homologação distribuída ativa: polling legado iFood DESATIVADO.");
  }
  setTimeout(pollEvents, 1500);
  setInterval(pollEvents, POLL_INTERVAL_MS);
});


// Polling exclusivo da homologação distribuída.
setInterval(pollHmlEvents, 30000);
setTimeout(pollHmlEvents, 5000);
