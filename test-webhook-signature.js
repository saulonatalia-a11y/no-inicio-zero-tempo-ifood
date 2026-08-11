const crypto = require("crypto");

const secret = process.env.IFOOD_CLIENT_SECRET;
if (!secret) {
  console.error("Defina IFOOD_CLIENT_SECRET antes de rodar este teste.");
  process.exit(1);
}

const body = Buffer.from(JSON.stringify({
  id: "local-test-event",
  code: "KEEPALIVE",
  createdAt: new Date().toISOString()
}));

const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

console.log("Webhook local:");
console.log("POST http://localhost:3000/webhook/ifood");
console.log("Header X-IFood-Signature:", signature);
console.log("Body:", body.toString());
