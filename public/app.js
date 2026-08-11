
const $ = s => document.querySelector(s);
const pollBtn = $("#pollBtn");
let currentSettings = null;
let latestOrders = [];

async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erro");
  return data;
}

function money(value) {
  if (value == null) return "";
  let n = typeof value === "number" ? value : (value.value ?? value.subTotal ?? value.orderAmount);
  if (n == null) return "";
  if (Number(n) > 1000 && Number.isInteger(Number(n))) n = Number(n)/100;
  return Number(n).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}

function stageFor(o){
  const s = String(o.status || "").toUpperCase();

  if (o.isClosed || ["CONCLUDED","COMPLETED","CON"].includes(s)) return "finished";
  if (["CANCELLED","CANCELED","CAN"].includes(s) || s.includes("CANCEL")) return "finished";

  if (["DSP","DISPATCHED","DISPATCH_REQUESTED"].includes(s) || s.includes("DELIVERY") || s.includes("DELIVER")) return "delivery";

  if (["PREPARATION_REQUESTED","PRS","DDCR"].includes(s) || s.includes("PREPAR")) return "prep";

  if (["CONFIRMED","CFM","CONFIRM_REQUESTED"].includes(s)) return "prep";

  if (["PLACED","PLC","NEW"].includes(s) || !s) return "new";

  return "ready";
}

function friendlyStatus(status){
  const s = String(status || "").toUpperCase();
  const map = {
    PLC:"Novo",
    PLACED:"Novo",
    CFM:"Confirmado",
    CONFIRMED:"Confirmado",
    CONFIRM_REQUESTED:"Confirmando",
    PRS:"Preparando",
    PREPARATION_REQUESTED:"Preparando",
    DDCR:"Preparando",
    DSP:"Em entrega",
    DISPATCH_REQUESTED:"Despachando",
    CANCELLED:"Cancelado",
    CAN:"Cancelado",
    CONCLUDED:"Finalizado",
    CON:"Finalizado"
  };
  return map[s] || status || "Atualizado";
}

async function loadStatus(){
  try{
    const s = await api("/api/status");
    const c = $("#connection");
    c.textContent = s.configured ? "iFood conectado" : "Falta configurar credenciais";
    c.className = "connection " + (s.configured ? "ok" : "bad");
    $("#autoDispatchMetric").textContent = `${s.dispatchDelaySeconds || 10}s`;
    const mode = s.transport === "webhook" ? "Tempo real / Webhook" : "Polling";
    const statusEl = document.querySelector(".metric strong.ok");
    if (statusEl) statusEl.textContent = s.configured ? mode : "Não configurado";
  }catch(e){ console.error(e); }
}

async function loadSettings(){
  currentSettings = await api("/api/settings");
  $("#autoConfirm").checked = !!currentSettings.autoConfirm;
  $("#autoStartPreparation").checked = !!currentSettings.autoStartPreparation;
  $("#autoDispatch").checked = !!currentSettings.autoDispatch;
  $("#dispatchDelaySeconds").value = currentSettings.dispatchDelaySeconds || 10;
}

async function loadOrders(){
  const list = await api("/api/orders");
  latestOrders = list;
  const stages = {new:[],prep:[],ready:[],delivery:[],finished:[]};
  list.forEach(o => stages[stageFor(o)].push(o));

  for (const [stage, arr] of Object.entries(stages)){
    $(`#count-${stage}`).textContent = arr.length;
    const col = $(`#col-${stage}`);
    col.innerHTML = "";
    if (!arr.length) col.innerHTML = '<div class="empty">Nenhum pedido</div>';
    arr.forEach(o => col.appendChild(renderOrder(o)));
  }

  $("#activeCount").textContent = stages.new.length + stages.prep.length + stages.ready.length + stages.delivery.length;
  $("#finishedCount").textContent = stages.finished.length;
}

function renderOrder(o){
  const node = $("#orderTpl").content.cloneNode(true);
  const root = node.querySelector(".order-card");
  node.querySelector(".order-id").textContent = `#${o.displayId || String(o.id).slice(0,8)}`;
  node.querySelector(".status-badge").textContent = friendlyStatus(o.status);
  if (o.autoDispatchDueAt && stageFor(o) === "prep") {
    const badge = node.querySelector(".status-badge");
    badge.dataset.dueAt = o.autoDispatchDueAt;
    badge.classList.add("countdown-badge");
  }

  const items = node.querySelector(".items");
  const itemList = Array.isArray(o.items) ? o.items : [];
  items.innerHTML = itemList.length
    ? itemList.map(i=>`<div class="item"><span class="qty">${i.quantity || 1}x</span><span>${escapeHtml(i.name || i.externalCode || "Item")}</span></div>`).join("")
    : '<span class="empty">Sem itens</span>';

  node.querySelector(".total").textContent = money(o.total) || "";

  const closed = o.isClosed || ["CANCELLED","CONCLUDED"].includes(String(o.status||"").toUpperCase());
  node.querySelectorAll("[data-action]").forEach(btn=>{
    if (closed) btn.disabled = true;
    else btn.onclick = () => runAction(o.id, btn.dataset.action, btn);
  });

  if (stageFor(o) === "delivery") {
    root.querySelector('[data-action="dispatch"]').disabled = true;
  }

  return node;
}

async function runAction(id, action, btn){
  if(action === "dispatch" && !confirm("Confirma o despacho deste pedido?")) return;
  btn.disabled = true;
  try{
    await api(`/api/orders/${encodeURIComponent(id)}/${action}`, {method:"POST"});
    await refresh();
  }catch(e){
    alert(e.message);
  }finally{
    btn.disabled = false;
  }
}

async function loadLogs(){
  const list = await api("/api/logs");
  $("#logs").innerHTML = list.length ? list.map(x=>
    `<div class="log ${escapeHtml(x.type)}"><b>${new Date(x.at).toLocaleTimeString("pt-BR")}</b> — ${escapeHtml(x.message)}</div>`
  ).join("") : '<div class="empty">Sem atividade</div>';
}

async function refresh(){
  await Promise.all([loadStatus(), loadOrders(), loadLogs()]);
}

pollBtn.onclick = async()=>{
  pollBtn.disabled=true;
  try{ await api("/api/poll",{method:"POST"}); await refresh(); }
  catch(e){ alert(e.message); }
  finally{ pollBtn.disabled=false; }
};

$("#settingsBtn").onclick = async()=>{
  await loadSettings();
  $("#settingsModal").classList.remove("hidden");
};
$("#closeSettings").onclick = ()=>$("#settingsModal").classList.add("hidden");

$("#saveSettings").onclick = async()=>{
  const btn = $("#saveSettings");
  btn.disabled = true;
  try{
    await api("/api/settings",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        autoConfirm: $("#autoConfirm").checked,
        autoStartPreparation: $("#autoStartPreparation").checked,
        autoDispatch: $("#autoDispatch").checked,
        dispatchDelaySeconds: Number($("#dispatchDelaySeconds").value || 10)
      })
    });
    $("#settingsModal").classList.add("hidden");
    await refresh();
  }catch(e){
    alert(e.message);
  }finally{
    btn.disabled=false;
  }
};


function showView(name){
  document.querySelectorAll(".view-panel").forEach(v=>v.classList.add("hidden"));
  document.querySelector(`#view-${name}`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item[data-view]").forEach(btn=>btn.classList.toggle("active", btn.dataset.view===name));
  if(name==="settings") loadSettingsPage();
  if(name==="history") renderHistory();
  if(name==="logs") loadFullLogs();
}
document.querySelectorAll(".nav-item[data-view]").forEach(btn=>btn.onclick=()=>showView(btn.dataset.view));

async function loadSettingsPage(){
  const s = await api("/api/settings");
  $("#pageAutoConfirm").checked = !!s.autoConfirm;
  $("#pageAutoStartPreparation").checked = !!s.autoStartPreparation;
  $("#pageAutoDispatch").checked = !!s.autoDispatch;
  $("#pageDispatchDelaySeconds").value = s.dispatchDelaySeconds || 10;
}
$("#pageSaveSettings")?.addEventListener("click", async()=>{
  const btn=$("#pageSaveSettings"); btn.disabled=true;
  try{
    await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      autoConfirm:$("#pageAutoConfirm").checked,
      autoStartPreparation:$("#pageAutoStartPreparation").checked,
      autoDispatch:$("#pageAutoDispatch").checked,
      dispatchDelaySeconds:Number($("#pageDispatchDelaySeconds").value||10)
    })});
    alert("Configurações salvas.");
    await refresh();
  }catch(e){alert(e.message)} finally{btn.disabled=false}
});
function renderHistory(){
  const list=latestOrders.filter(o=>o.isClosed||["CANCELLED","CONCLUDED","COMPLETED","CON"].includes(String(o.status||"").toUpperCase()));
  $("#historyList").innerHTML=list.length?list.map(o=>`<div class="simple-row"><div><strong>#${escapeHtml(o.displayId||String(o.id).slice(0,8))}</strong><div>${escapeHtml(friendlyStatus(o.status))}</div></div><strong>${escapeHtml(money(o.total)||"")}</strong></div>`).join(""):'<div class="empty">Nenhum pedido no histórico.</div>';
}
async function loadFullLogs(){
  const list=await api("/api/logs");
  $("#fullLogs").innerHTML=list.length?list.map(x=>`<div class="log ${escapeHtml(x.type)}"><b>${new Date(x.at).toLocaleTimeString("pt-BR")}</b> — ${escapeHtml(x.message)}</div>`).join(""):'<div class="empty">Sem atividade</div>';
}
$("#refreshLogs")?.addEventListener("click",loadFullLogs);
function updateCountdowns(){
  document.querySelectorAll("[data-due-at]").forEach(el=>{
    const left=Math.max(0,Math.ceil((new Date(el.dataset.dueAt).getTime()-Date.now())/1000));
    el.textContent=left>0?`Despacha em ${left}s`:"Despachando...";
  });
}
setInterval(updateCountdowns,500);

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

refresh();
setInterval(refresh, 5000);
