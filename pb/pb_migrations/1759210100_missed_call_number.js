/// clients.missed_call_number — Yeastar webhook matches the called DID to a client.
migrate((app) => {
  const c = app.findCollectionByNameOrId("clients");
  if (!c.fields.getByName) { /* ponytail: newer PB API */ }
  c.fields.add(new TextField({ name: "missed_call_number", max: 30 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("clients");
  for (const f of c.fields) if (f.name === "missed_call_number") c.fields.remove(f);
  app.save(c);
});