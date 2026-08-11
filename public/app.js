
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
  const stage = String(o.stage || "").toUpperCase();

  if (o.isClosed || stage === "FINISHED" || ["CONCLUDED","COMPLETED","CON","CANCELLED","CANCELED","CAN"].includes(s)) return "finished";
  if (stage === "DELIVERY" || ["DSP","DISPATCHED"].includes(s)) return "delivery";
  if (stage === "READY" || ["RTP","READY_TO_PICKUP","READY_REQUESTED"].includes(s)) return "ready";
  if (stage === "PREPARATION" || ["PREPARATION_REQUESTED","PREPARATION","PRS","DDCR","CONFIRMED","CFM","CONFIRM_REQUESTED"].includes(s)) return "prep";
  return "new";
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
    RTP:"Pronto",
    READY_TO_PICKUP:"Pronto",
    READY_REQUESTED:"Pronto",
    DSP:"Em entrega",
    DISPATCHED:"Em entrega",
    DISPATCH_REQUESTED:"Em entrega",
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
    $("#autoDispatchMetric").textContent = `${s.acceptDelaySeconds ?? 5}s + ${s.readyDelaySeconds ?? 10}s`;
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
  const timerEl = node.querySelector(".order-timer");
  if(timerEl) timerEl.textContent = stageTimerText(o);
  if (o.confirmDueAt && stageFor(o) === "new") {
    const badge = node.querySelector(".status-badge");
    badge.dataset.dueAt = o.confirmDueAt;
    badge.dataset.countdownLabel = "Aceita em";
    badge.classList.add("countdown-badge");
  } else if (o.readyDueAt && stageFor(o) === "prep") {
    const badge = node.querySelector(".status-badge");
    badge.dataset.dueAt = o.readyDueAt;
    badge.dataset.countdownLabel = "Pronto em";
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



let currentPrintSettings = null;

const PRINT_AGENT = "http://127.0.0.1:17891";

async function refreshPrintAssistant(showAlert = true){
  const badge = $("#assistantStatusBadge");
  const text = $("#assistantStatusText");
  const select = $("#printSelectedPrinter");
  try{
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 1800);
    const res = await fetch(`${PRINT_AGENT}/status`, {signal:controller.signal});
    clearTimeout(timeout);
    if(!res.ok) throw new Error("offline");
    const data = await res.json();

    badge.textContent = "Aberto";
    badge.classList.remove("closed");
    badge.classList.add("open");
    text.textContent = `Assistente conectado · ${data.printers?.length || 0} impressora(s) encontrada(s).`;

    const current = currentPrintSettings?.selectedPrinter || select.value;
    select.innerHTML = '<option value="">Selecione uma impressora</option>' +
      (data.printers || []).map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
    if(current) select.value = current;
    return true;
  }catch(e){
    badge.textContent = "Fechado";
    badge.classList.remove("open");
    badge.classList.add("closed");
    text.textContent = "Abra o TurboFlow Print Agent no computador para ativar.";
    select.innerHTML = '<option value="">Assistente fechado</option>';
    if(showAlert) alert("TurboFlow Print Agent não está aberto neste computador.");
    return false;
  }
}

$("#refreshAssistant")?.addEventListener("click", ()=>refreshPrintAssistant(true));

$("#openAssistant")?.addEventListener("click", async()=>{
  const ok = await refreshPrintAssistant(false);
  if(ok){
    alert("O TurboFlow Print Agent já está aberto.");
  }else{
    alert("Se você já instalou o Assistente, abra pelo atalho do Windows ou execute ABRIR-TURBOFLOW-PRINT-AGENT.bat.");
  }
});

function receiptToPlainText(data, s){
  const widthChars = s.paperWidth === "58" ? 32 : 48;
  const sep = "-".repeat(widthChars);
  const lines = [];

  lines.push(data.storeName.toUpperCase());
  if(s.showCnpj) lines.push(`CNPJ ${data.cnpj}`);
  lines.push(sep);
  if(s.showOrderId) lines.push(`PEDIDO ${data.orderId}`);
  if(s.showCustomer) lines.push(`Cliente: ${data.customer}`);
  if(s.showAddress) lines.push(`Entrega: ${data.address}`);
  lines.push(sep);
  lines.push("ITENS DO PEDIDO");

  let lastCat = "";
  for(const it of data.items || []){
    if(s.showCategories && it.category !== lastCat){
      lines.push("");
      lines.push(String(it.category || "").toUpperCase());
      lastCat = it.category;
    }
    lines.push(`${it.qty}x ${it.name}  ${money(it.price)}`);
    if(s.showDescription && it.desc) lines.push(`  ${it.desc}`);
    for(const addon of (it.addons || [])) lines.push(`  ${addon}`);
  }

  lines.push(sep);
  if(s.showPayment){
    lines.push("PAGAMENTO");
    lines.push(data.payment || "");
  }
  lines.push(`TOTAL: ${money(data.total)}`);
  lines.push("");
  lines.push("");
  return lines.join("\r\n");
}

async function printThroughAgent(data, settingsOverride = null){
  const s = settingsOverride || currentPrintSettings || collectPrintSettings();
  if(!s.useAssistant) throw new Error("Assistente de impressão desativado.");
  if(!s.selectedPrinter) throw new Error("Nenhuma impressora selecionada.");

  const text = receiptToPlainText(data, s);
  const copies = Math.max(1, Number(s.copies || 1));

  for(let i=0;i<copies;i++){
    const res = await fetch(`${PRINT_AGENT}/print`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({printer:s.selectedPrinter, text})
    });
    const body = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(body.error || "Falha ao imprimir.");
  }
  return true;
}


async function loadPrintingPage(){
  const s = await api("/api/print-settings");
  currentPrintSettings = s;
  $("#printPaperWidth").value = s.paperWidth || "80";
  $("#printFontSize").value = s.fontSize || 12;
  $("#printShowCnpj").checked = !!s.showCnpj;
  $("#printShowCategories").checked = !!s.showCategories;
  $("#printShowDescription").checked = !!s.showDescription;
  $("#printShowAddonGroupTitle").checked = !!s.showAddonGroupTitle;
  $("#printShowCustomer").checked = s.showCustomer !== false;
  $("#printShowAddress").checked = s.showAddress !== false;
  $("#printShowPayment").checked = s.showPayment !== false;
  $("#printShowOrderId").checked = s.showOrderId !== false;
  $("#printUseAssistant").checked = !!s.useAssistant;
  $("#printAutoPrint").checked = !!s.autoPrint;
  $("#printCopies").value = s.copies || 1;
  await refreshPrintAssistant(false);
  if(s.selectedPrinter) $("#printSelectedPrinter").value = s.selectedPrinter;
  const radio = document.querySelector(`input[name="groupIdentical"][value="${s.groupIdentical || "separate"}"]`);
  if(radio) radio.checked = true;
  renderReceiptPreview();
}

function collectPrintSettings(){
  return {
    paperWidth: $("#printPaperWidth").value,
    fontSize: Number($("#printFontSize").value || 12),
    showCnpj: $("#printShowCnpj").checked,
    showCategories: $("#printShowCategories").checked,
    showDescription: $("#printShowDescription").checked,
    showAddonGroupTitle: $("#printShowAddonGroupTitle").checked,
    showCustomer: $("#printShowCustomer").checked,
    showAddress: $("#printShowAddress").checked,
    showPayment: $("#printShowPayment").checked,
    showOrderId: $("#printShowOrderId").checked,
    showPhone: false,
    groupIdentical: document.querySelector('input[name="groupIdentical"]:checked')?.value || "separate",
    useAssistant: $("#printUseAssistant")?.checked || false,
    autoPrint: $("#printAutoPrint")?.checked || false,
    selectedPrinter: $("#printSelectedPrinter")?.value || "",
    copies: Number($("#printCopies")?.value || 1)
  };
}

function sampleReceiptData(){
  return {
    storeName: "SUA LOJA",
    cnpj: "12.345.678/0001-90",
    orderId: "B-0001",
    customer: "Cliente Teste",
    address: "Rua Exemplo, 123 - Centro",
    items: [
      {category:"HAMBÚRGUERES", qty:1, name:"Hambúrguer Turbo", price:25, desc:"Pão, carne, queijo e molho", addons:["1 Bacon","1 Maionese"]},
      {category:"HAMBÚRGUERES", qty:1, name:"Combo Turbo", price:35, desc:"Hambúrguer + batata + bebida", addons:["1 Cheddar","1 Refrigerante"]}
    ],
    payment:"Pago online",
    total:60
  };
}

function buildReceiptHtml(data, s){
  const itemHtml = data.items.map((it,i)=>{
    const cat = s.showCategories && (i===0 || data.items[i-1]?.category!==it.category) ? `<div class="r-cat">${escapeHtml(it.category)}</div>` : "";
    const desc = s.showDescription ? `<div class="r-desc">${escapeHtml(it.desc||"")}</div>` : "";
    const addons = (it.addons||[]).map(a=>`<div class="r-addon">${escapeHtml(a)}</div>`).join("");
    return `${cat}<div class="r-item"><span>${it.qty}x ${escapeHtml(it.name)}</span><b>${money(it.price)}</b></div>${desc}${addons}`;
  }).join("");

  return `
    <div class="r-store">${escapeHtml(data.storeName)}</div>
    ${s.showCnpj ? `<div class="r-center">CNPJ ${escapeHtml(data.cnpj)}</div>` : ""}
    <div class="r-sep"></div>
    ${s.showOrderId ? `<div class="r-center"><b>Pedido</b><br>${escapeHtml(data.orderId)}</div>` : ""}
    ${s.showCustomer ? `<div class="r-line"><b>Cliente:</b> ${escapeHtml(data.customer)}</div>` : ""}
    ${s.showAddress ? `<div class="r-line"><b>Entrega:</b> ${escapeHtml(data.address)}</div>` : ""}
    <div class="r-sep"></div>
    <div class="r-center"><b>ITENS DO PEDIDO</b></div>
    ${itemHtml}
    <div class="r-sep"></div>
    ${s.showPayment ? `<div class="r-center"><b>PAGAMENTO</b></div><div class="r-line">${escapeHtml(data.payment)}</div>` : ""}
    <div class="r-total"><span>Total</span><b>${money(data.total)}</b></div>
  `;
}

function renderReceiptPreview(){
  const s = collectPrintSettings();
  const preview = $("#receiptPreview");
  if(!preview) return;
  preview.classList.toggle("paper-58", s.paperWidth==="58");
  preview.classList.toggle("paper-80", s.paperWidth==="80");
  preview.style.fontSize = `${s.fontSize}px`;
  preview.innerHTML = buildReceiptHtml(sampleReceiptData(), s);
}

["printPaperWidth","printFontSize","printShowCnpj","printShowCategories","printShowDescription","printShowAddonGroupTitle","printShowCustomer","printShowAddress","printShowPayment","printShowOrderId"].forEach(id=>{
  document.addEventListener("change", e=>{ if(e.target?.id===id) renderReceiptPreview(); });
  document.addEventListener("input", e=>{ if(e.target?.id===id) renderReceiptPreview(); });
});
document.addEventListener("change", e=>{
  if(e.target?.name==="groupIdentical") renderReceiptPreview();
});

$("#savePrintSettings")?.addEventListener("click", async()=>{
  const s = collectPrintSettings();
  try{
    currentPrintSettings = await api("/api/print-settings",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(s)
    });
    alert("Configuração de impressão salva.");
  }catch(e){ alert(e.message); }
});

$("#printTest")?.addEventListener("click", async()=>{
  const s = collectPrintSettings();
  const data = sampleReceiptData();

  if(s.useAssistant && s.selectedPrinter){
    try{
      await printThroughAgent(data, s);
      alert("Notinha de teste enviada para a impressora.");
      return;
    }catch(e){
      alert(`Falha no Assistente: ${e.message}\n\nVou abrir a impressão normal do navegador.`);
    }
  }

  const w = window.open("", "_blank", "width=600,height=800");
  const paperMm = s.paperWidth==="58" ? 58 : 80;
  w.document.write(`<!doctype html><html><head><title>TurboFlow - Impressão teste</title>
    <style>
      @page{size:${paperMm}mm auto;margin:3mm}
      body{font-family:Arial,sans-serif;width:${paperMm-6}mm;margin:0 auto;font-size:${s.fontSize}px;color:#000}
      .r-store,.r-center{text-align:center}.r-store{font-weight:800;font-size:1.15em}
      .r-sep{border-top:1px dashed #000;margin:8px 0}
      .r-item,.r-total{display:flex;justify-content:space-between;gap:8px}
      .r-item{margin:5px 0}.r-total{font-size:1.1em;margin-top:8px}
      .r-cat{font-weight:800;margin-top:7px}.r-desc,.r-addon{font-size:.9em;margin-left:8px}
      .r-line{margin:4px 0}
    </style></head><body>${buildReceiptHtml(data,s)}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(),300);
});

function showView(name){
  document.querySelectorAll(".view-panel").forEach(v=>v.classList.add("hidden"));
  document.querySelector(`#view-${name}`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item[data-view]").forEach(btn=>btn.classList.toggle("active", btn.dataset.view===name));
  if(name==="settings") loadSettingsPage();
  if(name==="history") renderHistory();
  if(name==="logs") loadFullLogs();
  if(name==="printing") loadPrintingPage();
}
document.querySelectorAll(".nav-item[data-view]").forEach(btn=>btn.onclick=()=>showView(btn.dataset.view));

async function loadSettingsPage(){
  const s = await api("/api/settings");
  $("#pageAutoConfirm").checked = !!s.autoConfirm;
  $("#pageAutoStartPreparation").checked = !!s.autoStartPreparation;
  $("#pageAutoReady").checked = !!s.autoReady;
  $("#pageAcceptDelaySeconds").value = s.acceptDelaySeconds ?? 5;
  $("#pageReadyDelaySeconds").value = s.readyDelaySeconds ?? 10;
}
$("#pageSaveSettings")?.addEventListener("click", async()=>{
  const btn=$("#pageSaveSettings"); btn.disabled=true;
  try{
    await api("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      autoConfirm:$("#pageAutoConfirm").checked,
      autoStartPreparation:$("#pageAutoStartPreparation").checked,
      autoReady:$("#pageAutoReady").checked,
      acceptDelaySeconds:Number($("#pageAcceptDelaySeconds").value||5),
      readyDelaySeconds:Number($("#pageReadyDelaySeconds").value||10)
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
    const label = el.dataset.countdownLabel || "Tempo";
    el.textContent=left>0?`${label} ${left}s`:"Executando...";
  });

  document.querySelectorAll(".order-card").forEach(card=>{
    const id = card.dataset.orderId;
    if(!id) return;
    const o = latestOrders.find(x=>String(x.id)===String(id));
    if(!o) return;
    const timer = card.querySelector(".order-timer");
    if(timer) timer.textContent = stageTimerText(o);
  });
}
setInterval(updateCountdowns,500);


function elapsedText(from, to = Date.now()){
  if(!from) return "";
  const start = new Date(from).getTime();
  const end = typeof to === "number" ? to : new Date(to).getTime();
  if(!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const total = Math.max(0, Math.floor((end-start)/1000));
  const h = Math.floor(total/3600);
  const m = Math.floor((total%3600)/60);
  const s = total%60;
  if(h>0) return `${h}h ${String(m).padStart(2,"0")}m`;
  if(m>0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
}

function stageTimerText(o){
  const stage = stageFor(o);
  if(stage==="new" && o.confirmDueAt){
    const left = Math.max(0, Math.ceil((new Date(o.confirmDueAt).getTime()-Date.now())/1000));
    return left>0 ? `Aceita em ${left}s` : "Aceitando...";
  }
  if(stage==="prep" && o.readyDueAt){
    const left = Math.max(0, Math.ceil((new Date(o.readyDueAt).getTime()-Date.now())/1000));
    return left>0 ? `Pronto em ${left}s` : "Marcando pronto...";
  }
  if(stage==="ready"){
    return o.readyAt ? `Aguardando entregador · ${elapsedText(o.readyAt)}` : "Aguardando entregador";
  }
  if(stage==="delivery"){
    return o.dispatchedAt ? `Em entrega há ${elapsedText(o.dispatchedAt)}` : "Em entrega";
  }
  if(stage==="finished"){
    const start = o.receivedAt || o.createdAt;
    const end = o.finishedAt || o.updatedAt;
    return start && end ? `Tempo total ${elapsedText(start, end)}` : "Finalizado";
  }
  return "";
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

refresh();
setInterval(refresh, 5000);
