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
    acceptDelaySeconds: 5,
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
    storeName: user.storeName || "",
    cnpj: user.cnpj || "",
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
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) return tokenCache.accessToken;

  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
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
  const secret = process.env.IFOOD_CLIENT_SECRET;
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
          log("heartbeat", "KEEPALIVE recebido do iFood.");
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
  if (isPolling) return;
  isPolling = true;
  try {
    const { data } = await ifoodRequest("/events/v1.0/events:polling");
    const events = Array.isArray(data) ? data : (data?.events || []);
    if (!events.length) return;

    events.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    const processedIds = [];
    for (const event of events) {
      try {
        await processEvent(event);
        if (event.id) processedIds.push(event.id);
      } catch (err) {
        log("error", `Erro processando evento ${event.id || "sem-id"}: ${err.message}`, event);
      }
    }

    if (processedIds.length) {
      const acknowledgmentBody = processedIds.map(id => ({ id }));
      await ifoodRequest("/events/v1.0/events/acknowledgment", {
        method: "POST",
        body: JSON.stringify(acknowledgmentBody)
      });
      log("ack", `${processedIds.length} evento(s) confirmado(s) ao iFood.`);
    }
  } catch (err) {
    log("error", err.message);
  } finally {
    isPolling = false;
  }
}

async function processEvent(event) {
  const code = String(event.code || event.fullCode || "").toUpperCase();
  const orderId = event.orderId || event.order?.id;
  log("event", `${code || "EVENTO"} ${orderId || ""}`.trim(), event);

  if (!orderId) return;

  // Novo pedido: busca detalhes imediatamente e agenda o aceite.
  if (["PLACED", "PLC"].includes(code) || code.includes("PLACED")) {
    const detail = await getOrderDetail(orderId);
    const normalized = normalizeOrder(detail);
    normalized.status = "PLACED";
    normalized.stage = "NEW";
    normalized.receivedAt = normalized.receivedAt || new Date().toISOString();
    orders.set(orderId, normalized);

    if (settings.autoConfirm && !autoConfirmDone.has(orderId) && !confirmTimers.has(orderId)) {
      scheduleAutoConfirm(orderId);
    }
    return;
  }

  // Confirmado: entra em preparo e agenda "pronto para retirada".
  if (["CONFIRMED", "CFM"].includes(code) || code.includes("CONFIRMED")) {
    const current = orders.get(orderId) || { id: orderId };
    current.status = "CONFIRMED";
    current.stage = "PREPARATION";
    current.preparationStartedAt = current.preparationStartedAt || new Date().toISOString();
    current.updatedAt = new Date().toISOString();
    current.confirmDueAt = null;
    orders.set(orderId, current);

    if (settings.autoStartPreparation && !autoStartDone.has(orderId)) {
      autoStartDone.add(orderId);
      await actionStartPreparation(orderId);
      log("auto", `Início de preparo automático executado para ${orderId}.`);
    }

    if (settings.autoReady && !autoReadyDone.has(orderId) && !readyTimers.has(orderId)) {
      scheduleAutoReady(orderId);
    }
    return;
  }

  // Preparando. Mantém/agendas o timer de pronto se ainda necessário.
  if (["PRS", "DDCR"].includes(code) || code.includes("PREPAR")) {
    const current = orders.get(orderId) || { id: orderId };
    current.status = "PREPARATION";
    current.stage = "PREPARATION";
    current.updatedAt = new Date().toISOString();
    orders.set(orderId, current);

    if (settings.autoReady && !autoReadyDone.has(orderId) && !readyTimers.has(orderId)) {
      scheduleAutoReady(orderId);
    }
    return;
  }

  // Ready to pickup: pedido pronto, esperando entregador.
  if (["RTP", "READY_TO_PICKUP", "READYTOPICKUP"].includes(code) || code.includes("READY_TO_PICKUP")) {
    const current = orders.get(orderId) || { id: orderId };
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
    const current = orders.get(orderId) || { id: orderId };
    current.status = "DISPATCHED";
    current.stage = "DELIVERY";
    current.dispatchedAt = current.dispatchedAt || new Date().toISOString();
    current.updatedAt = new Date().toISOString();
    orders.set(orderId, current);
    return;
  }

  const current = orders.get(orderId) || { id: orderId };

  if (["CAN", "CANCELLED", "CANCELED"].includes(code) || code.includes("CANCEL")) {
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

async function getOrderDetail(id) {
  const { data } = await ifoodRequest(`/order/v1.0/orders/${encodeURIComponent(id)}`);
  return data;
}

function normalizeOrder(o) {
  return {
    id: o.id,
    displayId: o.displayId || o.shortReference || o.id?.slice(0, 8),
    status: o.status || "PLACED",
    orderType: o.orderType,
    category: o.category,
    createdAt: o.createdAt,
    createdAt: order.createdAt || order.createdDate || order.orderTiming || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    merchant: o.merchant,
    customer: o.customer,
    items: o.items || [],
    total: o.total,
    delivery: o.delivery,
    raw: o
  };
}


function scheduleAutoConfirm(id) {
  if (!settings.autoConfirm || autoConfirmDone.has(id)) return;
  if (confirmTimers.has(id)) clearTimeout(confirmTimers.get(id));

  const delayMs = Math.max(0, Number(settings.acceptDelaySeconds || 5)) * 1000;
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

      await actionConfirm(id);
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

function scheduleAutoReady(id) {
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

      await actionReadyToPickup(id);
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

async function actionConfirm(id) {
  await ifoodRequest(`/order/v1.0/orders/${encodeURIComponent(id)}/confirm`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "CONFIRM_REQUESTED";
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Confirmação enviada para ${id}`);
  return current;
}

async function actionStartPreparation(id) {
  await ifoodRequest(`/order/v1.0/orders/${encodeURIComponent(id)}/startPreparation`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "PREPARATION_REQUESTED";
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Início de preparo enviado para ${id}`);
  return current;
}

async function actionReadyToPickup(id) {
  await ifoodRequest(`/order/v1.0/orders/${encodeURIComponent(id)}/readyToPickup`, { method: "POST" });
  const current = orders.get(id) || { id };
  current.status = "READY_REQUESTED";
  current.stage = "READY";
  current.readyDueAt = null;
  current.updatedAt = new Date().toISOString();
  orders.set(id, current);
  log("action", `Pedido pronto enviado para ${id}`);
  return current;
}

async function actionDispatch(id) {
  await ifoodRequest(`/order/v1.0/orders/${encodeURIComponent(id)}/dispatch`, { method: "POST" });
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
      configured: Boolean(process.env.IFOOD_CLIENT_ID && process.env.IFOOD_CLIENT_SECRET),
      polling: isPolling,
      autoConfirm: settings.autoConfirm,
      autoStartPreparation: settings.autoStartPreparation,
      autoReady: settings.autoReady,
      acceptDelaySeconds: settings.acceptDelaySeconds,
      readyDelaySeconds: settings.readyDelaySeconds,
      printSettings: settings.printSettings,
      pollIntervalMs: POLL_INTERVAL_MS,
      transport: "webhook",
      webhookPath: "/webhook/ifood",
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

  if (req.method === "GET" && url.pathname === "/api/orders") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    return json(res, 200, [...orders.values()].sort((a,b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0)));
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    return json(res, 200, eventsLog);
  }

  if (req.method === "POST" && url.pathname === "/api/poll") {
    const activeUser = requireActiveCustomer(req, res); if (!activeUser) return;
    await pollEvents();
    return json(res, 200, { ok: true });
  }

  const actionMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/(confirm|start|ready|dispatch)$/);
  if (req.method === "POST" && actionMatch) {
    const id = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    let result;
    if (action === "confirm") result = await actionConfirm(id);
    if (action === "start") result = await actionStartPreparation(id);
    if (action === "ready") result = await actionReadyToPickup(id);
    if (action === "dispatch") result = await actionDispatch(id);
    return json(res, 200, { ok: true, order: result });
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

    if (req.method === "POST" && url.pathname === "/webhook/ifood") {
      return await handleWebhook(req, res);
    }

    if (req.method === "GET" && url.pathname === "/webhook/ifood/health") {
      return json(res, 200, {
        ok: true,
        webhook: "/webhook/ifood",
        configured: Boolean(process.env.IFOOD_CLIENT_SECRET)
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
  console.log(`TurboFlow: http://localhost:${PORT}`);
  console.log(`Webhook local: http://localhost:${PORT}/webhook/ifood`);
  console.log(`Webhook 99Food: http://localhost:${PORT}/webhook/99food`);
  console.log(`Polling de contingência a cada ${Math.round(POLL_INTERVAL_MS / 60000)} min`);
  console.log(`Aguardando URL pública HTTPS para ativar o webhook no portal iFood...`);
  setTimeout(pollEvents, 1500);
  setInterval(pollEvents, POLL_INTERVAL_MS);
});
