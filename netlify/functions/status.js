"use strict";
/* GET /api/status - what the sign-in screen needs to know before anyone signs in. */
const store = require("../../lib/store.js");

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") return store.reply(405, { error: "Use GET." });
  try {
    const db = await store.loadDb();
    return store.reply(200, {
      needsSetup: store.needsSetup(db),
      signup: store.signupOpen(db)
    });
  } catch (e) {
    return store.errorReply(e);
  }
};
