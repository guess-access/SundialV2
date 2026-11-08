/* Rebuild restore-data.json for POST /api/migrate from the old app's CSV
   timesheet exports (Nov 1-8 2026) + the People/Schedules screenshots.
   Run: node scripts/build-restore.js  */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOWNLOADS = "C:/Users/Cebuana Guest/Downloads";
const CSV_FILES = [
  "timesheet-peter.king-2026-11-01.csv",
  "timesheet-m.guzman-2026-11-01.csv",
  "timesheet-mafe-2026-11-01.csv",
  "timesheet-j.cubillas-2026-11-01.csv",
  "timesheet-nadz.c-2026-11-01.csv"
];

/* ---------------- csv ---------------- */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}

/* ---------------- time helpers (US Eastern, EST = UTC-5 in November) ---------------- */
const EST_OFFSET_MIN = 5 * 60;   // November 2026 is after the DST change
function etToUtc(dateKey, mins) {
  const p = dateKey.split("-");
  const h = Math.floor(mins / 60), mi = mins % 60;
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], h + EST_OFFSET_MIN / 60, mi, 0));
}
function parseTime(t) {   // "11:00 AM" -> minutes of day, null if absent
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t || "").trim());
  if (!m) return null;
  let h = +m[1] % 12; if (/PM/i.test(m[3])) h += 12;
  return h * 60 + +m[2];
}

/* ---------------- sha256 passcode, same scheme the app sends ---------------- */
function mkAuth(pin) {
  const salt = crypto.randomBytes(12).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + "|" + pin).digest("hex");
  return { salt, hash };
}

/* ---------------- people (from the People screenshot) ---------------- */
// pin: the temporary passcode every account signs in with (admin can reset it per person)
const PIN = "sundial1234";
const people = [
  { username: "site.admin",  name: "Prime Kreatives",            role: "admin", pin: "admin1234",
    info: { position: "Admin", hired: "2025-11-01" } },
  { username: "peter.king",  name: "Clyde Mark Gomez",           role: "staff",
    info: { position: "Staff" },
    schedules: [{ from: "2026-10-25", days: fiveDays(660, 960) }] },          // Mon-Fri 11:00 AM-4:00 PM
  { username: "a.bmizo",     name: "Aldwin M Barrizo",           role: "staff", info: { position: "Staff" } },
  { username: "jazzie",      name: "Jazzzemar Gaze Monil",       role: "lead",  info: { position: "Lead" } },
  { username: "mafe",        name: "Mariafe Lacostales Trinidad",role: "lead",  info: { position: "Lead" } },
  { username: "a.mengibar",  name: "Amwar Glean Mengibar",       role: "staff", info: { position: "Staff" } },
  { username: "m.guzman",    name: "Mervin Guzman",              role: "staff",
    info: { position: "Staff" },
    schedules: [{ from: "2026-11-01", days: [
      null,                                                                   // Sun
      { start: 9 * 60, end: 19 * 60 },                                        // Mon 9-7 (CSV Nov 2)
      { start: 10 * 60, end: 19 * 60 },                                       // Tue 10-7
      { start: 10 * 60, end: 19 * 60 },                                       // Wed 10-7
      null,                                                                   // Thu rest (CSV Nov 5)
      { start: 10 * 60, end: 19 * 60 },                                       // Fri 10-7
      { start: 8 * 60, end: 17 * 60 }                                         // Sat 8-5
    ] }] },
  { username: "e.mendoza",   name: "Ericia Mendoza",             role: "staff",
    info: { position: "Staff" },
    schedules: [{ from: "2026-10-25", days: fiveDays(7 * 60, 16 * 60) }] },   // Mon-Fri 7:00 AM-4:00 PM
  { username: "j.cubillas",  name: "Janilia Cubillas",           role: "staff",
    info: { position: "Staff" },
    schedules: [{ from: "2026-11-01", days: fiveDays(12 * 60, 21 * 60) }] },  // Mon-Fri 12:00 PM-9:00 PM
  { username: "nadz.c",      name: "Reynald Cantos",             role: "staff",
    info: { position: "Staff" },
    schedules: [{ from: "2026-11-01", days: [
      null,                                                                   // Sun
      { start: 12 * 60, end: 21 * 60 },                                       // Mon 12-9
      null,                                                                   // Tue rest (CSV Nov 3)
      { start: 12 * 60, end: 21 * 60 },                                       // Wed 12-9
      { start: 12 * 60, end: 21 * 60 },                                       // Thu 12-9
      { start: 12 * 60, end: 21 * 60 },                                       // Fri 12-9
      { start: 7 * 60, end: 16 * 60 }                                         // Sat 7 AM-4 PM
    ] }] }
];
function fiveDays(start, end) {
  const win = { start, end };
  return [null, win, win, win, win, win, null];   // Sun..Sat: Mon-Fri on
}

/* ---------------- rebuild shifts from the CSVs ---------------- */
const PAUSE_KINDS = ["break1", "break2", "bio", "lunch", "outage"];   // CSV column order
const users = [];
const byUsername = {};
people.forEach((p, i) => {
  const auth = mkAuth(p.pin);
  const u = {
    id: "u" + (i + 1),
    username: p.username, name: p.name, role: p.role,
    salt: auth.salt, hash: auth.hash,
    active: true, createdAt: "2026-10-25T00:00:00.000Z",
    position: p.info.position || "", hired: p.info.hired || "2026-10-25"
  };
  if (p.role === "admin") u.payrollAccess = true;
  if (p.schedules) { u.schedules = p.schedules; u.sched = p.schedules[p.schedules.length - 1].days; }
  users.push(u); byUsername[p.username] = u;
});

let eid = 0;
const entries = [];
const csvWorked = {};   // the old CSV's own Worked (hours) column, for comparison
for (const file of CSV_FILES) {
  const rows = parseCsv(fs.readFileSync(path.join(DOWNLOADS, file), "utf8"));
  for (const r of rows.slice(1)) {
    const username = r[1].trim();
    const u = byUsername[username];
    if (!u) { console.log("skipping row for unknown user:", username); continue; }
    const date = r[2].trim();
    const inM = parseTime(r[6]), outM = parseTime(r[7]);
    if (inM === null) continue;                    // no clock-in recorded that day
    csvWorked[username + "|" + date] = parseFloat(r[16] || "0") || 0;
    // old export kept the shift's own clock-out; before clock-in means overnight
    let outKey = date;
    if (outM !== null && outM < inM) {
      const nd = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1);
      outKey = nd.getFullYear() + "-" + String(nd.getMonth() + 1).padStart(2, "0") + "-" + String(nd.getDate()).padStart(2, "0");
    }
    const inAt = etToUtc(date, inM).toISOString();
    const outAt = outM === null ? null : etToUtc(outKey, outM).toISOString();
    const span = outAt ? etToUtc(outKey, outM).getTime() - etToUtc(date, inM).getTime() : 0;
    // recorded pause minutes per kind: B1,B2,Bio,Lunch,Offline live at columns 10-14;
    // column 15 is the old "Total paid break (min)" and column 16 the old Worked figure
    const mins = {};
    PAUSE_KINDS.forEach((k, j) => { mins[k] = parseFloat(r[10 + j] || "0") || 0; });
    const pauses = placePauses(PAUSE_KINDS.map(k => ({ k, m: mins[k] })), etToUtc(date, inM).getTime(), outAt ? etToUtc(outKey, outM).getTime() : null);
    eid++;
    entries.push({ id: "e" + eid, userId: u.id, date, inAt, outAt, pauses: pauses.filter(Boolean) });
    if (span && mins.outage + mins.lunch > span / 60000) {
      console.log("WARN pauses > span:", username, date);
    }
  }
}

function placePauses(kinds, inMs, outMs) {
  const runs = kinds.filter(x => x.m > 0);
  if (!runs.length || !outMs) return [];
  const total = runs.reduce((s, x) => s + x.m, 0);
  const span = outMs - inMs;
  // start one hour in; keep 15-minute gaps; compress the gaps if the total is tight
  let gap = 15 * 60000, cursor = inMs + 60 * 60000;
  if (total + 60 * 60000 + gap * (runs.length - 1) > span) gap = Math.max(0, (span - 60 * 60000 - total) / Math.max(1, runs.length - 1));
  return runs.map(x => {
    const start = Math.min(cursor, outMs - x.m * 60000);
    const run = { type: x.k, start: new Date(start).toISOString(), end: new Date(Math.min(start + x.m * 60000, outMs)).toISOString() };
    cursor = start + x.m * 60000 + gap;
    return run;
  });
}

/* ---------------- new-rule worked-hours check ----------------
   The sheet recomputes everything live as workedMs = span - unpaid
   (break1 + break2 + lunch + outage; bio stays paid), so the old values
   are only for comparison. Rows the old code double-counted show up here. */
const unpaidMin = e => e.pauses
  .filter(p => p.type !== "bio")
  .reduce((s, p) => s + (new Date(p.end) - new Date(p.start)) / 60000, 0);
const fmtH = ms => {
  const m = Math.round(ms / 60000);
  return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");
};
console.log("\nwork per day (old CSV figure -> new-rule recompute):");
const perUser = {};
for (const e of entries) {
  const span = new Date(e.outAt) - new Date(e.inAt);
  const fresh = fmtH(span - unpaidMin(e) * 60000);
  const who = users.find(u => u.id === e.userId).username;
  const csvRow = csvWorked[who + "|" + e.date];
  const flag = csvRow != null && Math.abs(csvRow - (span - unpaidMin(e) * 60000) / 3600000) > 0.03
    ? "   (old said " + csvRow.toFixed(2) + ")"
    : "";
  perUser[who] = (perUser[who] || 0) + (span - unpaidMin(e) * 60000);
  console.log("  " + who.padEnd(11) + e.date + "  " + fresh.padStart(5) + flag);
}
console.log("\ntotals Nov 1-8 under the new rule:");
Object.keys(perUser).forEach(k => console.log("  " + k.padEnd(11) + fmtH(perUser[k]).padStart(5) + "  (" + (perUser[k] / 3600000).toFixed(2) + " h)"));

/* ---------------- assemble ---------------- */
const state = {
  users,
  entries,
  requests: [],
  payroll: [],
  settings: { signup: true, audit: [] },
  sessionUserId: users[0].id
};
fs.mkdirSync("scripts/out", { recursive: true });
fs.writeFileSync(path.join("scripts/out/restore-data.json"), JSON.stringify(state, null, 2));
console.log("users:", users.length, "entries:", entries.length);
console.log("temporary passcodes: site.admin = admin1234, everybody else =", PIN);
users.forEach(u => console.log("  -", u.username, "(" + u.role + ") shifts:", entries.filter(e => e.userId === u.id).length));
