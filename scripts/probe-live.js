// quick one-shot probe of the live site markers
(async () => {
  const base = "https://sundialsolstice.netlify.app";
  const a = await fetch(base + "/app.html?bust=" + Date.now());
  const h = await a.text();
  console.log("app.html:", a.status, "bytes:", h.length);
  console.log("  daySched:", /daySched/.test(h));
  console.log("  auditMore:", /auditMore/.test(h));
  console.log("  dateLockedFor:", /dateLockedFor/.test(h));
  console.log("  btnBackup:", /btnBackup/.test(h));
  const s = await fetch(base + "/api/health");
  console.log("health:", s.status, JSON.stringify(await s.json()));
})();
