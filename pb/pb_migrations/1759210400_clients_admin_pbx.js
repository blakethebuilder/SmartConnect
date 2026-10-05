/// Admin + per-client Yeastar creds.
function exists(app, name) {
  try { app.findCollectionByNameOrId(name); return true; } catch (e) { return false; }
}

migrate((app) => {
  if (!exists(app, "clients")) return; // init runs first on fresh installs
  const c = app.findCollectionByNameOrId("clients");
  for (const f of [
    new BoolField({ name: "admin" }),
    new TextField({ name: "yeastar_base", max: 200 }),
    new TextField({ name: "yeastar_username", max: 100 }),
    new TextField({ name: "yeastar_password", max: 200, hidden: true }),
  ]) {
    if (!c.fields.find((x) => x.name === f.name)) c.fields.add(f);
  }
  app.save(c);
}, (app) => {
  if (!exists(app, "clients")) return;
  const c = app.findCollectionByNameOrId("clients");
  for (const n of ["admin", "yeastar_base", "yeastar_username", "yeastar_password"]) {
    const f = c.fields.find((x) => x.name === n);
    if (f) c.fields.removeByName(n);
  }
  app.save(c);
});
