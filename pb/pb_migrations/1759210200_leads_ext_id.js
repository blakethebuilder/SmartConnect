/// leads.ext_id — dedupe key for Yeastar CDR uids (idempotent poller).
migrate((app) => {
  const c = app.findCollectionByNameOrId("leads");
  c.fields.add(new TextField({ name: "ext_id", max: 120 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("leads");
  for (const f of c.fields) if (f.name === "ext_id") c.fields.remove(f);
  app.save(c);
});