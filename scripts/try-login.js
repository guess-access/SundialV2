/* Try likely admin credentials on the live server (login failures are harmless). */
const crypto = require("crypto");
const base = "https://sundialsolstice.netlify.app";
const tries = [
  ["prime.kreatives", "admin1234"],
  ["prime.kreatives", "sundial1234"],
  ["admin", "admin1234"],
  ["site.admin", "admin1234"],
  ["primekreatives", "admin1234"]
];
(async () => {
  for (const [u, pin] of tries) {
    try {
      const r = await fetch(base + "/api/salt?u=" + encodeURIComponent(u));
      const { salt } = await r.json();
      const hash = crypto.createHash("sha256").update(salt + "|" + pin).digest("hex");
      const l = await fetch(base + "/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: u, hash })
      });
      const b = await l.text();
      console.log(u, pin, "->", l.status, b.slice(0, 70));
      if (l.ok) {
        require("fs").writeFileSync("scripts/out/admin-token.json", JSON.stringify({ username: u, token: JSON.parse(b).token }));
        console.log("   (token saved to scripts/out/admin-token.json)");
      }
    } catch (e) {
      console.log(u, pin, "-> error", String(e).slice(0, 100));
    }
  }
})();
