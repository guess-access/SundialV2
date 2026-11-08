/* poll the live site until the Request Logs build is serving */
const base = "https://sundialsolstice.netlify.app";
(async () => {
  const deadline = Date.now() + 8 * 60000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/app.html?bust=" + Math.random());
      const h = await r.text();
      if (/renderReqLogs/.test(h) && /reqLogList/.test(h) && /quickApprove/.test(h)) {
        console.log("NEW CODE IS LIVE — Request Logs markers found, bytes:", h.length);
        return;
      }
      console.log("not yet (" + h.length + " bytes)");
    } catch (e) { console.log("transient:", e.message); }
    await new Promise(res => setTimeout(res, 20000));
  }
  console.log("TIMEOUT after 8 min");
})();
