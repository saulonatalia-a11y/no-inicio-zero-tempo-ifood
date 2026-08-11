
function sampleReceiptData(){
  return {
    storeName:"TURBOFLOW",
    cnpj:"61.096.705/0001-00",
    source:"iFood",
    orderId:"9499",
    customer:"João Silva",
    address:"Rua Exemplo, 123 - Centro",
    neighborhood:"Centro",
    reference:"Próximo à padaria",
    items:[
      {
        category:"HAMBÚRGUERES",
        qty:1,
        name:"Hambúrguer Turbo 2",
        description:"",
        addons:["1x Bacon","1x Maionese"],
        observations:"Sem cebola"
      },
      {
        category:"HAMBÚRGUERES",
        qty:1,
        name:"Combo Turbo 3",
        description:"",
        addons:["1x Cheddar","1x Refrigerante"],
        observations:"Ponto da carne: ao ponto"
      }
    ],
    payment:"Pago online",
    total:21
  };
}


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




function buildStructuredReceipt(data, s){
  return {
    company: "TURBOFLOW",
    source: data.source || "iFood",
    orderId: data.orderId || "",
    cnpj: s.showCnpj ? (data.cnpj || "") : "",
    showOrderId: s.showOrderId !== false,
    showCustomer: s.showCustomer !== false,
    showAddress: s.showAddress !== false,
    showPayment: s.showPayment !== false,
    showTotal: s.showTotal !== false,
    customer: data.customer || "",
    address: data.address || "",
    neighborhood: data.neighborhood || "",
    reference: data.reference || "",
    payment: data.payment || "",
    total: Number(data.total || 0),
    items: (data.items || []).map(it=>({
      category: s.showCategories ? (it.category || "") : "",
      qty: Number(it.qty || 1),
      name: it.name || "",
      description: s.showDescription ? (it.description || "") : "",
      addons: Array.isArray(it.addons) ? it.addons : [],
      observations: it.observations || ""
    }))
  };
}

async function printThroughAgent(data, settingsOverride = null){
  const s = settingsOverride || collectPrintSettings() || currentPrintSettings;
  if(!s.useAssistant) throw new Error("Assistente de impressão desativado.");
  if(!s.selectedPrinter) throw new Error("Nenhuma impressora selecionada.");

  const text = receiptToPlainText(data, s);
  const copies = Math.max(1, Number(s.copies || 1));

  for(let i=0;i<copies;i++){
    const res = await fetch(`${PRINT_AGENT}/print`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        printer:s.selectedPrinter,
        text,
        receipt:buildStructuredReceipt(data, s),
        copies:Number(s.copies || 1),
        fontSize:Number(s.fontSize || 12),
        companyFontSize:Number(s.companyFontSize || 28),
        paperWidth:String(s.paperWidth || "80")
      })
    });
    const body = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(body.error || "Falha ao imprimir.");
  }
  return true;
}



function tfEscape(v){
  return escapeHtml(String(v ?? ""));
}

function tfMoney(v){
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
}

function normalizeReceiptOrder(order){
  const customer =
    order?.customer?.name ||
    order?.customerName ||
    order?.customer?.firstName ||
    "Cliente";

  const delivery = order?.delivery || order?.deliveryAddress || order?.shipping || {};
  const addr = delivery?.deliveryAddress || delivery?.address || delivery || {};

  const street = addr?.streetName || addr?.street || addr?.address || "";
  const number = addr?.streetNumber || addr?.number || "";
  const neighborhood = addr?.neighborhood || addr?.district || addr?.bairro || "";
  const city = addr?.city || addr?.cityName || "";
  const complement = addr?.complement || addr?.details || "";
  const reference = addr?.reference || addr?.referencePoint || addr?.observations || "";

  const fullAddress = [street, number].filter(Boolean).join(", ") +
    (complement ? ` - ${complement}` : "") +
    (city ? ` - ${city}` : "");

  const displayId =
    order?.displayId ||
    order?.shortReference ||
    order?.orderNumber ||
    order?.id?.slice?.(0,8) ||
    "0000";

  const items = Array.isArray(order?.items) ? order.items : [];

  const mappedItems = items.map((it)=>{
    const addons = [];
    const opts = it?.options || it?.garnishes || it?.subItems || it?.complements || [];
    if(Array.isArray(opts)){
      for(const op of opts){
        const qty = Number(op?.quantity || op?.qty || 1);
        const name = op?.name || op?.description || op?.title || "Adicional";
        addons.push(`${qty}x ${name}`);
      }
    }

    const observations =
      it?.observations ||
      it?.observation ||
      it?.notes ||
      it?.note ||
      "";

    return {
      category: it?.category || it?.categoryName || "ITENS",
      qty: Number(it?.quantity || it?.qty || 1),
      name: it?.name || it?.description || "Produto",
      unitPrice: Number(it?.unitPrice || it?.price || it?.totalPrice || 0),
      totalPrice: Number(it?.totalPrice || it?.price || it?.unitPrice || 0),
      description: it?.description && it?.description !== it?.name ? it.description : "",
      addons,
      observations
    };
  });

  const paymentMethod =
    order?.payments?.methods?.[0]?.method ||
    order?.payments?.methods?.[0]?.type ||
    order?.payment?.method ||
    order?.paymentMethod ||
    order?.payments?.prepaid ? "Pago online" : "Pagamento";

  const total =
    order?.total?.orderAmount ||
    order?.total?.total ||
    order?.orderTotal ||
    order?.totalAmount ||
    mappedItems.reduce((sum,it)=>sum + Number(it.totalPrice || 0),0);

  const merchantCnpj =
    order?.merchant?.cnpj ||
    order?.merchant?.document ||
    order?.merchant?.documentNumber ||
    order?.merchantCnpj ||
    order?.merchantDocument ||
    "";

  const orderSourceRaw =
    order?.source ||
    order?.platform ||
    order?.provider ||
    order?.channel ||
    order?.salesChannel ||
    order?.app ||
    "iFood";

  const orderSourceText = String(orderSourceRaw || "iFood");
  const orderSource =
    /99/i.test(orderSourceText) ? "99Food" :
    /ifood/i.test(orderSourceText) ? "iFood" :
    orderSourceText;

  return {
    storeName: order?.merchant?.name || order?.merchantName || "TURBOFLOW",
    cnpj: merchantCnpj,
    source: orderSource,
    orderId: String(displayId).replace(/^#/,""),
    customer,
    address: fullAddress || "Retirada / endereço não informado",
    neighborhood,
    reference,
    items: mappedItems,
    payment: paymentMethod,
    total: Number(total || 0)
  };
}

function buildReceiptHtml(data, s){
  const items = (data.items || []).map((it, idx)=>{
    const prev = data.items[idx-1];
    const cat = s.showCategories && (!prev || prev.category !== it.category)
      ? `<div class="r-category">${tfEscape(String(it.category || "ITENS").toUpperCase())}</div>` : "";

    const desc = s.showDescription && it.description
      ? `<div class="r-description">${tfEscape(it.description)}</div>` : "";

    const addons = (it.addons || []).map(a=>
      `<div class="r-addon">- ${tfEscape(a)}</div>`
    ).join("");

    const obs = it.observations
      ? `<div class="r-item-note"><strong>OBS:</strong> ${tfEscape(it.observations)}</div>` : "";

    return `
      ${cat}
      <div class="r-product">
        <div class="r-product-name">${tfEscape(it.qty)}x ${tfEscape(String(it.name || "").toUpperCase())}</div>
        ${addons}
        ${desc}
        ${obs}
      </div>
      <div class="r-mini-sep"></div>
    `;
  }).join("");

  const customerBlock = s.showCustomer !== false
    ? `<div class="r-meta"><strong>CLIENTE:</strong> <span>${tfEscape(data.customer)}</span></div>` : "";

  const addressBlock = s.showAddress !== false
    ? `
      <div class="r-meta"><strong>ENTREGA:</strong> <span>${tfEscape(data.address)}</span></div>
      ${data.neighborhood ? `<div class="r-meta"><strong>BAIRRO:</strong> <span>${tfEscape(data.neighborhood)}</span></div>` : ""}
      ${data.reference ? `<div class="r-meta"><strong>REFERÊNCIA:</strong> <span>${tfEscape(data.reference)}</span></div>` : ""}
    ` : "";

  const orderBlock = s.showOrderId !== false
    ? `<div class="r-order-number">#${tfEscape(data.orderId)}</div>` : "";

  const paymentBlock = s.showPayment !== false
    ? `
      <div class="r-topline"></div>
      <div class="r-section-label">PAGAMENTO</div>
      <div class="r-payment">${tfEscape(data.payment || "Pagamento")}</div>
    ` : "";

  const totalBlock = s.showTotal !== false
    ? `
      <div class="r-topline"></div>
      <div class="r-total-row">
        <strong>TOTAL:</strong>
        <strong>${tfMoney(data.total)}</strong>
      </div>
    ` : "";

  return `
    <div class="r-topline"></div>
    <div class="r-brand">TURBOFLOW</div>
    <div class="r-source">${tfEscape(data.source || "iFood")}</div>
    <div class="r-subtitle">PEDIDO RECEBIDO</div>
    ${s.showCnpj && data.cnpj ? `<div class="r-cnpj"><strong>CNPJ:</strong> ${tfEscape(data.cnpj)}</div>` : ""}
    <div class="r-topline"></div>

    ${orderBlock}
    ${(customerBlock || addressBlock) ? `<div class="r-topline"></div>${customerBlock}${addressBlock}` : ""}

    <div class="r-topline"></div>
    <div class="r-section-title">ITENS DO PEDIDO</div>
    <div class="r-topline"></div>

    ${items}

    ${paymentBlock}
    ${totalBlock}
    <div class="r-topline"></div>
  `;
}

function wrapText(text, width){
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  for(const word of words){
    const next = line ? `${line} ${word}` : word;
    if(next.length <= width){
      line = next;
    }else{
      if(line) out.push(line);
      if(word.length > width){
        let rest = word;
        while(rest.length > width){
          out.push(rest.slice(0,width));
          rest = rest.slice(width);
        }
        line = rest;
      }else{
        line = word;
      }
    }
  }
  if(line) out.push(line);
  return out;
}

function centerText(text, width){
  const t = String(text || "");
  const left = Math.max(0, Math.floor((width - t.length)/2));
  return " ".repeat(left) + t;
}

function receiptToPlainText(data, s){
  const width = s.paperWidth === "58" ? 30 : 42;
  const sep = "=".repeat(width);
  const mini = "-".repeat(width);

  const lines = [];
  lines.push(sep);
  lines.push(centerText("TURBOFLOW", width));
  lines.push(centerText(data.source || "iFood", width));
  lines.push(centerText("PEDIDO RECEBIDO", width));
  if(s.showCnpj && data.cnpj){
    lines.push(centerText(`CNPJ: ${data.cnpj}`, width));
  }
  lines.push(sep);

  if(s.showOrderId !== false){
    lines.push("");
    lines.push(centerText(`#${data.orderId}`, width));
    lines.push("");
    lines.push(sep);
  }

  const pushLabel = (label, value)=>{
    const prefix = `${label}: `;
    const usable = Math.max(8, width - prefix.length);
    const wrapped = wrapText(value, usable);
    if(!wrapped.length){
      lines.push(prefix);
      return;
    }
    lines.push(prefix + wrapped[0]);
    for(const w of wrapped.slice(1)){
      lines.push(" ".repeat(prefix.length) + w);
    }
  };

  if(s.showCustomer !== false){
    pushLabel("CLIENTE", data.customer);
  }

  if(s.showAddress !== false){
    pushLabel("ENTREGA", data.address);
    if(data.neighborhood) pushLabel("BAIRRO", data.neighborhood);
    if(data.reference) pushLabel("REFERENCIA", data.reference);
  }

  if(s.showCustomer !== false || s.showAddress !== false){
    lines.push(sep);
  }

  lines.push(centerText("ITENS DO PEDIDO", width));
  lines.push(sep);

  let lastCategory = "";
  for(const it of data.items || []){
    if(s.showCategories && it.category !== lastCategory){
      lines.push(String(it.category || "ITENS").toUpperCase());
      lastCategory = it.category;
    }

    const product = `${it.qty}x ${String(it.name || "").toUpperCase()}`;
    for(const l of wrapText(product, width)) lines.push(l);

    for(const addon of (it.addons || [])){
      for(const l of wrapText(`- ${addon}`, width-2)){
        lines.push("  " + l);
      }
    }

    if(s.showDescription && it.description){
      for(const l of wrapText(it.description, width-2)){
        lines.push("  " + l);
      }
    }

    if(it.observations){
      for(const l of wrapText(`OBS: ${it.observations}`, width)){
        lines.push(l.toUpperCase());
      }
    }

    lines.push(mini);
  }

  if(s.showPayment !== false){
    lines.push("PAGAMENTO");
    for(const l of wrapText(data.payment || "Pagamento", width)){
      lines.push(l);
    }
  }

  if(s.showTotal !== false){
    if(s.showPayment !== false) lines.push(sep);
    const totalText = tfMoney(data.total);
    const label = "TOTAL:";
    const spaces = Math.max(1, width - label.length - totalText.length);
    lines.push(label + " ".repeat(spaces) + totalText);
  }

  lines.push(sep);
  lines.push("");
  lines.push("");

  return lines.join("\r\n");
}

async function loadPrintingPage(){
  const s = await api("/api/print-settings");
  currentPrintSettings = s;
  $("#printPaperWidth").value = s.paperWidth || "80";
  $("#printFontSize").value = Number(s.fontSize || 12);
  if($("#printCompanyFontSize")) $("#printCompanyFontSize").value = Number(s.companyFontSize || 28);
  $("#printShowCnpj").checked = !!s.showCnpj;
  $("#printShowCategories").checked = !!s.showCategories;
  $("#printShowDescription").checked = !!s.showDescription;
  $("#printShowAddonGroupTitle").checked = !!s.showAddonGroupTitle;
  $("#printShowCustomer").checked = s.showCustomer !== false;
  $("#printShowAddress").checked = s.showAddress !== false;
  $("#printShowPayment").checked = s.showPayment !== false;
  if($("#printShowTotal")) $("#printShowTotal").checked = s.showTotal !== false;
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
    companyFontSize: Number($("#printCompanyFontSize")?.value || 28),
    showCnpj: $("#printShowCnpj").checked,
    showCategories: $("#printShowCategories").checked,
    showDescription: $("#printShowDescription").checked,
    showAddonGroupTitle: $("#printShowAddonGroupTitle").checked,
    showCustomer: $("#printShowCustomer").checked,
    showAddress: $("#printShowAddress").checked,
    showPayment: $("#printShowPayment").checked,
    showTotal: $("#printShowTotal")?.checked !== false,
    showOrderId: $("#printShowOrderId").checked,
    showPhone: false,
    groupIdentical: document.querySelector('input[name="groupIdentical"]:checked')?.value || "separate",
    useAssistant: $("#printUseAssistant")?.checked || false,
    autoPrint: $("#printAutoPrint")?.checked || false,
    selectedPrinter: $("#printSelectedPrinter")?.value || "",
    copies: Number($("#printCopies")?.value || 1)
  };
}





function renderReceiptPreview(){
  const s = collectPrintSettings();
  const preview = $("#receiptPreview");
  if(!preview) return;
  preview.classList.toggle("paper-58", s.paperWidth==="58");
  preview.classList.toggle("paper-80", s.paperWidth==="80");
  preview.style.fontSize = `${s.fontSize}px`;
  preview.innerHTML = buildReceiptHtml(sampleReceiptData(), s);
  const brand = preview.querySelector(".r-brand");
  if(brand) brand.style.fontSize = `${Number(s.companyFontSize || 28)}px`;
}

["printPaperWidth","printFontSize","printCompanyFontSize","printShowCnpj","printShowCategories","printShowDescription","printShowAddonGroupTitle","printShowCustomer","printShowAddress","printShowPayment","printShowOrderId"].forEach(id=>{
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
    if($("#printFontSize")) $("#printFontSize").value = Number(currentPrintSettings.fontSize || s.fontSize || 12);
    if($("#printCompanyFontSize")) $("#printCompanyFontSize").value = Number(currentPrintSettings.companyFontSize || s.companyFontSize || 28);
    alert(`Configuração salva. Papel: ${currentPrintSettings.paperWidth || s.paperWidth}mm | Fonte do pedido: ${Number(currentPrintSettings.fontSize || s.fontSize || 12)} | Empresa: ${Number(currentPrintSettings.companyFontSize || s.companyFontSize || 28)}`);
  }catch(e){ alert(e.message); }
});

$("#printTest")?.addEventListener("click", async()=>{
  const s = collectPrintSettings();
  const data = sampleReceiptData();

  const agentOnline = await refreshPrintAssistant(false);

  if(!agentOnline){
    alert("O TurboFlow Assistente não está conectado. Abra o ícone T no Windows e clique em Atualizar conexão.");
    return;
  }

  if(!s.useAssistant){
    alert("Ative a opção 'Usar o Assistente para impressão'.");
    return;
  }

  if(!s.selectedPrinter){
    alert("Selecione uma impressora instalada no Windows.");
    return;
  }

  try{
    await printThroughAgent(data, s);
    alert("Notinha de teste enviada diretamente para a impressora.");
  }catch(e){
    alert(`Falha ao imprimir pelo TurboFlow Assistente: ${e.message}`);
  }
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


function refreshReceiptPreviewFromControls(){
  try{
    const preview = $("#receiptPreview");
    if(!preview) return;
    const s = collectPrintSettings();
    const data = sampleReceiptData();
    preview.classList.toggle("paper-58", s.paperWidth === "58");
    preview.classList.toggle("paper-80", s.paperWidth === "80");
    preview.style.fontSize = `${Number(s.fontSize || 15)}px`;
    preview.innerHTML = buildReceiptHtml(data, s);
    const brand = preview.querySelector(".r-brand");
    if(brand) brand.style.fontSize = `${Number(s.companyFontSize || 28)}px`;
  }catch(e){}
}

[
  "printShowCnpj","printShowCategories","printShowDescription","printShowAddonTitles",
  "printShowCustomer","printShowAddress","printShowPayment","printShowTotal","printShowOrderId",
  "printPaperWidth","printFontSize","printCompanyFontSize"
].forEach(id=>{
  document.getElementById(id)?.addEventListener("change", refreshReceiptPreviewFromControls);
  document.getElementById(id)?.addEventListener("input", refreshReceiptPreviewFromControls);
});
