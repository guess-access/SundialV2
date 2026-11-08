/* One-shot repair of the live server:
   - delete the duplicate users (ids u1..u10) and their entries (e1..e21) that
     my earlier sync added on top of the already-imported data,
   - merge credentials (salt/hash, temp passcode) and schedules from
     restore-data.json onto the real accounts, matched by username,
   - give the 9 standalone staff accounts a temp passcode too.
   Everything else (requests, payroll, announcements, tested shifts) stays. */
const fs = require("fs");
const crypto = require("crypto");
const base = "https://sundialsolstice.netlify.app";
const { token } = JSON.parse(fs.readFileSync("scripts/out/admin-token.json", "utf8"));
const restore = JSON.parse(fs.readFileSync("scripts/out/restore-data.json", "utf8"));
const PIN = "sundial1234";

function mkAuth(pin) {
  const salt = crypto.randomBytes(12).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + "|" + pin).digest("hex");
  return { salt, hash };
}

(async () => {
  const r = await fetch(base + "/api/state", { headers: { authorization: "Bearer " + token } });
  const s = await r.json();
  const users = s.users || [];
  const nameOf = {};
  users.forEach(u => (nameOf[u.id] = u.username));

  // duplicates = ids matching /^u\d+$/ from restore. Real accounts carry random ids.
  const mineUser = users.filter(u => /^u\d+$/.test(String(u.id)));
  const dupNames = mineUser.map(u => u.username);
  console.log("deleting duplicate users:", dupNames.join(", "));
  // credentials/schedules by username from restore
  const myEntries = (s.entries || []).filter(e => /^e\d+$/.test(String(e.id)));
  console.log("deleting duplicate entries:", myEntries.length);

  // credentials/schedules by username from restore
  const byName = {};
  restore.users.forEach(u => (byName[u.username] = u));

  const puts = [];
  for (const u of users) {
    if (/^u\d+$/.test(String(u.id))) continue;          // duplicates go away
    if (u.username === "prime.kreatives") continue;      // working admin, untouched
    const src = byName[u.username];
    const patch = { id: u.id };
    let dirty = false;
    if (!u.salt || !u.hash) {
      const a = src && src.salt && src.hash ? { salt: src.salt, hash: src.hash } : mkAuth(PIN);
      patch.salt = a.salt; patch.hash = a.hash; dirty = true;
    }
    if (src) {
      if (!u.schedules && Array.isArray(src.schedules) && src.schedules.length) { patch.schedules = src.schedules; dirty = true; }
      if (!u.sched && src.sched && !(Array.isArray(src.sched) && src.sched.some(d => d && d.start != null))) { patch.sched = src.sched; dirty = true; }
      if (src.position && !u.position) { patch.position = src.position; dirty = true; }
      if (src.name && !u.name) { patch.name = src.name; dirty = true; }
      if (src.role === "admin" && !u.payrollAccess) { patch.payrollAccess = true; dirty = true; }
    } else if (!u.salt || !u.hash) {
      // a real teammate with no restore record: temp passcode so they can sign in
      dirty = true;
    }
    if (dirty) puts.push(patch);
  }

  const delUsers = mineUser.map(u => ({ id: u.id }));
  const delEntries = myEntries.map(e => ({ id: e.id, userId: e.userId }));
  const patch = {
    users: { put: puts, del: delUsers },
    entries: { del: delEntries }
    // leave requests, payroll, announcements and settings exactly as they are
  };
  const resp = await fetch(base + "/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify(patch)
  });
  const body = await resp.json();
  if (!resp.ok) { console.log("FAIL", resp.status, JSON.stringify(body).slice(0, 400)); return; }
  console.log("after repair:", (body.users || []).length, "users,", (body.entries || []).length, "entries,", (body.requests || []).length, "requests");
  body.users.forEach(u => console.log("  ", u.username.padEnd(15), u.role.padEnd(6), (u.hash || "").slice(0, 6) ? "has-hash" : "NO HASH", u.schedules ? "sched-ok" : ""));
  fs.writeFileSync("scripts/out/admin-users.json", JSON.stringify(body, null, 2));
})();
