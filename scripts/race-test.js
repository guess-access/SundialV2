/* Decisive race test: write salt/hash for the standalone staff accounts, wait,
   then re-read. If the change vanishes, something else is saving stale state. */
const fs = require("fs");
const crypto = require("crypto");
const base = "https://sundialsolstice.netlify.app";
const { token } = JSON.parse(fs.readFileSync("scripts/out/admin-token.json", "utf8"));
const PIN = "sundial1234";
function mkAuth() {
  const salt = crypto.randomBytes(12).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + "|" + PIN).digest("hex");
  return { salt, hash };
}
async function state() {
  const r = await fetch(base + "/api/state", { headers: { authorization: "Bearer " + token } });
  return r.json();
}
(async () => {
  let s = await state();
  const targets = s.users.filter(u => u.username !== "prime.kreatives");
  const missing = targets.filter(u => !u.salt || !u.hash);
  console.log("users:", s.users.length, "entries:", s.entries.length, "missing hash:", missing.map(u => u.username).join(", "));
  if (missing.length) {
    const patch = { users: { put: missing.map(u => ({ id: u.id, ...mkAuth() })) } };
    const resp = await fetch(base + "/api/sync", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify(patch)
    });
    console.log("write:", resp.status, resp.ok ? "ok" : await resp.text());
  }
  for (const wait of [5, 25, 45]) {
    await new Promise(res => setTimeout(res, wait === 5 ? 5000 : (wait === 25 ? 20000 : 20000)));
    if (wait !== 5) console.log("(waited 20 more seconds...)");
    s = await state();
    const still = s.users.filter(u => u.username !== "prime.kreatives" && (!u.salt || !u.hash));
    console.log("after check @+" + wait + "s: users " + s.users.length + ", entries " + s.entries.length + ", missing hash now: ",
      still.length ? still.map(u => u.username).join(", ") : "none");
    if (s.users.length > 15) {
      console.log("  duplicates present again:", s.users.slice().reverse().map(u => u.username).join(", "));
      break;
    }
  }
  // try a real login with the temp passcode for a staff account
  const tmp = s.users.find(u => u.username === "k.roamar");
  if (tmp && tmp.salt && tmp.hash) {
    const hash = crypto.createHash("sha256").update(tmp.salt + "|" + PIN).digest("hex");
    const l = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "k.roamar", hash }) });
    console.log("login k.roamar/sundial1234 ->", l.status);
  } else {
    console.log("k.roamar still missing salt/hash — write did not survive");
  }
})();
