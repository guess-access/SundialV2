"use strict";
/* GET /api/salt?u=name - the salt the browser mixes into the passcode before
   sending it. A name that does not exist still gets a stable answer, so the
   response never reveals who has an account. */
const store = require("../../lib/store.js");

function stableSalt(name) {
  try {
    return require("crypto").createHash("sha256").update("no-such-user:" + name).digest("hex").slice(0, 24);
  } catch (e) {
    let h = 5381;
    const s = "no-such-user:" + name;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return ("00000000" + h.toString(16)).slice(-8);
  }
}

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") return store.reply(405, { error: "Use GET." });
  try {
    const db = await store.loadDb();
    const q = (event.queryStringParameters && event.queryStringParameters.u) || "";
    const user = store.findUser(db, q);
    const salt = (user && typeof user.salt === "string" && user.salt)
      ? user.salt
      : stableSalt(String(q).trim().toLowerCase());
    return store.reply(200, { salt });
  } catch (e) {
    return store.errorReply(e);
  }
};
