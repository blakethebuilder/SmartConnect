import os, time, httpx
PB = "http://pbdev:8090"
tok = httpx.post(PB + "/api/collections/_superusers/auth-with-password",
                 json={"identity": os.environ["PB_ADMIN_EMAIL"], "password": os.environ["PB_ADMIN_PASSWORD"]}).json()["token"]
h = {"Authorization": tok}
cl = httpx.post(PB + "/api/collections/clients/records", headers=h,
                json={"email": f"t{int(time.time())}@x.test", "password": "Test12345678!", "passwordConfirm": "Test12345678!",
                      "name": "T", "daily_send_cap": 250, "warmup_msgs_sent": 0, "active": True}).json()
for i in range(3):
    httpx.post(PB + "/api/collections/contacts/records", headers=h,
               json={"client": cl["id"], "phone": f"27120000{i:02d}", "optin": True})
httpx.post(PB + "/api/collections/contacts/records", headers=h,
           json={"client": cl["id"], "phone": "27129999999", "optin": False})
bc = httpx.post(PB + "/api/collections/broadcasts/records", headers=h,
                json={"client": cl["id"], "template": "fanout", "status": "queued"}).json()
ms = httpx.get(PB + "/api/collections/broadcast_msgs/records", headers=h).json()
print("fanout msgs:", ms["totalItems"], [m["status"] for m in ms["items"]])
