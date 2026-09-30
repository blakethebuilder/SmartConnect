/// Public signup: clients createRule "" (anyone can create own account).
/// ponytail: single rule change; deleteRule stays superusers-only.
migrate((app) => {
  const c = app.findCollectionByNameOrId("clients");
  c.createRule = "";
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("clients");
  c.createRule = null;
  app.save(c);
});