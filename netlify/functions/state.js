"use strict";
/* GET /api/state - the whole timesheet for the signed-in person.
   Their own passcode hash comes back (the page needs it to change a passcode);
   everyone else's is withheld. */
const store = require("../../lib/store.js");

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") return store.reply(405, { error: "Use GET." });
  try {
    const db = await store.loadDb();
    const me = await store.authUser(event, db);
    return store.reply(200, store.view(db, me.id));
  } catch (e) {
    return store.errorReply(e);
  }
};
