/// SmartConnect v1 — all collections in one idempotent migration.
/// PB v0.39 traps: findCollectionByNameOrId THROWS when missing (never returns null);
/// constructor-passed `fields:` arrays are SILENTLY DROPPED — every field must be
/// added post-construction via c.fields.add(new XxxField(...)).

function exists(app, name) {
  try {
    app.findCollectionByNameOrId(name);
    return true;
  } catch (e) {
    return false;
  }
}

function autodate(name) {
  return new AutodateField({ name: name, onCreate: true });
}

function clientRel(clients) {
  return new RelationField({
    name: "client",
    required: true,
    collectionId: clients.id,
    cascadeDelete: true,
    maxSelect: 1,
  });
}

migrate((app) => {
  // --- clients (auth collection; one record per business/client) ---
  if (!exists(app, "clients")) {
    const R = "id = @request.auth.id";
    const clients = new Collection({
      type: "auth",
      name: "clients",
      listRule: R,
      viewRule: R,
      createRule: null,
      updateRule: R,
      deleteRule: null,
    });
    clients.fields.add(new TextField({ name: "name", required: true, max: 120 }));
    clients.fields.add(new TextField({ name: "evolution_url" }));
    clients.fields.add(new TextField({ name: "evolution_instance", max: 100 }));
    clients.fields.add(new TextField({ name: "evolution_apikey", max: 200 }));
    clients.fields.add(new NumberField({ name: "daily_send_cap", onlyInt: true, min: 0, max: 100000 }));
    clients.fields.add(new NumberField({ name: "warmup_msgs_sent", onlyInt: true, min: 0 }));
    clients.fields.add(new TextField({ name: "plan", max: 40 }));
    clients.fields.add(new BoolField({ name: "active" }));
    clients.fields.add(autodate("created_at"));
    app.save(clients);
  }
  const clients = app.findCollectionByNameOrId("clients");

  // --- contacts (opt-in WhatsApp audience per client) ---
  if (!exists(app, "contacts")) {
    const R = '@request.auth.id != "" && client = @request.auth.id';
    const c = new Collection({
      type: "base",
      name: "contacts",
      listRule: R,
      viewRule: R,
      createRule: R,
      updateRule: R,
      deleteRule: R,
    });
    c.fields.add(clientRel(clients));
    c.fields.add(new TextField({ name: "phone", required: true, max: 32 }));
    c.fields.add(new BoolField({ name: "optin" }));
    c.fields.add(new BoolField({ name: "stopped" }));
    c.fields.add(autodate("created_at"));
    app.save(c);
  }

  // --- leads ---
  if (!exists(app, "leads")) {
    const R = '@request.auth.id != "" && client = @request.auth.id';
    const c = new Collection({
      type: "base",
      name: "leads",
      listRule: R,
      viewRule: R,
      createRule: R,
      updateRule: R,
      deleteRule: R,
    });
    c.fields.add(clientRel(clients));
    c.fields.add(new TextField({ name: "phone", max: 32 }));
    c.fields.add(new TextField({ name: "name", max: 120 }));
    c.fields.add(new TextField({ name: "intent", max: 40 }));
    c.fields.add(new TextField({ name: "notes", max: 2000 }));
    c.fields.add(new SelectField({ name: "status", maxSelect: 1, values: ["new", "contacted", "qualified", "paid", "lost"] }));
    c.fields.add(new TextField({ name: "source", max: 40 }));
    c.fields.add(autodate("created_at"));
    app.save(c);
  }

  // --- broadcasts (outbound campaign; worker claims status=queued) ---
  if (!exists(app, "broadcasts")) {
    const R = '@request.auth.id != "" && client = @request.auth.id';
    const c = new Collection({
      type: "base",
      name: "broadcasts",
      listRule: R,
      viewRule: R,
      createRule: R,
      updateRule: null,
      deleteRule: R,
    });
    c.fields.add(clientRel(clients));
    c.fields.add(new TextField({ name: "template", required: true, max: 2000 }));
    c.fields.add(new SelectField({ name: "status", maxSelect: 1, values: ["queued", "processing", "paused", "done"] }));
    c.fields.add(new NumberField({ name: "sent_count", onlyInt: true, min: 0 }));
    c.fields.add(autodate("created_at"));
    app.save(c);
  }

  // --- broadcast_msgs (per-contact send log / queue) ---
  if (!exists(app, "broadcast_msgs")) {
    const R = '@request.auth.id != "" && broadcast.client = @request.auth.id';
    const c = new Collection({
      type: "base",
      name: "broadcast_msgs",
      listRule: R,
      viewRule: R,
      createRule: R,
      updateRule: null,
      deleteRule: R,
    });
    const broadcasts = app.findCollectionByNameOrId("broadcasts");
    const contacts = app.findCollectionByNameOrId("contacts");
    c.fields.add(
      new RelationField({
        name: "broadcast",
        required: true,
        collectionId: broadcasts.id,
        cascadeDelete: true,
        maxSelect: 1,
      })
    );
    c.fields.add(
      new RelationField({
        name: "contact",
        required: true,
        collectionId: contacts.id,
        cascadeDelete: true,
        maxSelect: 1,
      })
    );
    c.fields.add(new SelectField({ name: "status", maxSelect: 1, values: ["pending", "sent", "failed"] }));
    c.fields.add(new TextField({ name: "error", max: 500 }));
    c.fields.add(autodate("created_at"));
    app.save(c);
  }

  // --- payments (Netcash pay-now links) ---
  if (!exists(app, "payments")) {
    const R = '@request.auth.id != "" && client = @request.auth.id';
    const c = new Collection({
      type: "base",
      name: "payments",
      listRule: R,
      viewRule: R,
      createRule: null,
      updateRule: null,
      deleteRule: R,
    });
    c.fields.add(clientRel(clients));
    c.fields.add(new TextField({ name: "phone", max: 32 }));
    c.fields.add(new NumberField({ name: "amount", min: 0 }));
    c.fields.add(new TextField({ name: "netcash_link" }));
    c.fields.add(new SelectField({ name: "status", maxSelect: 1, values: ["pending", "paid"] }));
    c.fields.add(new DateField({ name: "paid_at" }));
    c.fields.add(autodate("created_at"));
    app.save(c);
  }
}, (app) => {
  for (const name of ["payments", "broadcast_msgs", "broadcasts", "leads", "contacts", "clients"]) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (e) {}
  }
});
