/// clients.notify_number — owner gets "missed call from X" WhatsApp alert
migrate(
  (db) => db.collection("clients").addField("notify_number", "text"),
  (db) => db.collection("clients").removeField("notify_number")
)