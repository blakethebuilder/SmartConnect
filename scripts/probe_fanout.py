import os, time, httpx
PB = os.environ["PB_URL"]
tok = httpx.post(PB + "/api/collections/_superusers/auth-with-password",
                 json={"identity": os.environ["PB_ADMIN_EMAIL"], "password": os.environ["PB_ADMIN_PASSWORD"]}).json()["token"]
h = {"Authorization": tok}
cl = httpx.post(PB + "/api/collections/clients/records", headers=h,
                json={"email": f"t3{int(time.time())}@x.test", "password": "Test12345678!", "passwordConfirm": "Test12345678!",
                      "name": "T", "daily_send_cap": 250, "warmup_msgs_sent": 0, "active": True}).json()
co = httpx.post(PB + "/api/collections/contacts/records", headers=h,
                json={"client": cl["id"], "phone": "27111111101", "optin": True}).json()
bc = httpx.post(PB + "/api/collections/broadcasts/records", headers=h,
                json={"client": cl["id"], "template": "hi", "status": "queued"}).json()
ms = httpx.get(PB + "/api/collections/broadcast_msgs/records", headers=h).json()
print("contact:", co.get("id"), co.get("optin"), co.get("stopped"))
print("msgs total:", ms["totalItems"], ms["items"])
