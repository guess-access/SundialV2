/* Compare live server data against scripts/out/restore-data.json:
   1) entry windows + pause minutes per username/date,
   2) which users lack salt/hash/schedules. */
const fs = require("fs");
const base = "https://sundialsolstice.netlify.app";
const { token } = JSON.parse(fs.readFileSync("scripts/out/admin-token.json", "utf8"));
const restore = JSON.parse(fs.readFileSync("scripts/out/restore-data.json", "utf8"));

(async () => {
  const r = await fetch(base + "/api/state", { headers: { authorization: "Bearer " + token } });
  const s = await r.json();
  const nameOf = {};
  (s.users || []).forEach(u => (nameOf[u.id] = u.username));

  console.log("--- users missing credentials / schedules ---");
  (s.users || []).forEach(u => {
    const miss = [];
    if (!u.salt || !u.hash) miss.push("salt/hash");
    if (u.role === "admin" && u.payrollAccess !== true) miss.push("payrollAccess");
    if (u.username !== "prime.kreatives" && !u.schedules && !u.sched) miss.push("schedule");
    console.log("  " + u.username.padEnd(15), u.role.padEnd(6), miss.length ? "MISSING: " + miss.join(", ") : "ok");
  });

  console.log("\n--- entries: live vs restore ---");
  const live = {};
  (s.entries || []).forEach(e => (live[(nameOf[e.userId] || e.userId) + "|" + e.date] = e));
  let diffs = 0, missingLive = 0, extra = 0;
  for (const e of restore.entries) {
    const who = (restore.users.filter(u => u.id === e.userId)[0] || {}).username;
    const key = who + "|" + e.date;
    const L = live[key];
    if (!L) { missingLive++; console.log("  MISSING on server:", key); continue; }
    delete live[key];
    const spanL = new Date(L.outAt) - new Date(L.inAt), spanR = new Date(e.outAt) - new Date(e.inAt);
    const pauseL = (L.pauses || []).reduce((t, p) => t + (new Date(p.end) - new Date(p.start)) / 60000, 0);
    const pauseR = (e.pauses || []).reduce((t, p) => t + (new Date(p.end) - new Date(p.start)) / 60000, 0);
    if (Math.abs(spanL - spanR) > 60000 || Math.abs(pauseL - pauseR) > 0.5) {
      diffs++;
      console.log("  DIFF", key, "live span " + Math.round(spanL / 60000) + "m pauses " + pauseL + "m   restore span " + Math.round(spanR / 60000) + "m pauses " + pauseR + "m");
    }
  }
  extra = Object.keys(live).length;
  console.log("summary: same-window-same-pause entries match; diffs:", diffs, "restore-only:", missingLive, "server-only:", extra);
  console.log("requests on server:", (s.requests || []).length, "payroll:", (s.payroll || []).length);
})();
