"use strict";
/* GET /api/health - does storage answer? Same shape the original backend used:
   node / read / write / conditional / ok, where "conditional" means a read that
   only returns the value when its ETag has changed. */
const store = require("../../lib/store.js");

exports.handler = async (event) => {
  store.connect(event);
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") return store.reply(405, { error: "Use GET." });
  const report = await store.probe();
  return store.reply(200, report);
};
