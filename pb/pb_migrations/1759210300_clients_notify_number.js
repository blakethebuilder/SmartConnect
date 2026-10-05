/// clients.notify_number — owner gets "missed call from X" WhatsApp alert
migrate((app) => {
  const c = app.findCollectionByNameOrId("clients");
  c.fields.add(new TextField({ name: "notify_number", max: 30 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("clients");
  for (const f of c.fields) if (f.name === "notify_number") c.fields.remove(f);
  app.save(c);
});
