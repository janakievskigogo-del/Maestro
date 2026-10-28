import json
import tempfile
import threading
import unittest
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from server import create_server
class RestaurantApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.http_server = create_server(
            db_path=f"{self.temp_dir.name}/restaurant.sqlite3",

            host="127.0.0.1",

            port=0,

        )
        self.server_thread = threading.Thread(
            target=self.http_server.serve_forever, daemon=True
        )
        self.server_thread.start()
        host, port = self.http_server.server_address
        self.base_url = f"http://{host}:{port}"
        self.client = build_opener(HTTPCookieProcessor(CookieJar()))
    def tearDown(self):
        self.http_server.shutdown()
        self.http_server.server_close()
        self.server_thread.join(timeout=2)
        self.temp_dir.cleanup()
    def request_json(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",

            data=body,

            method=method,

            headers={"Content-Type": "application/json"},

        )
        try:
            with self.client.open(request) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except HTTPError as response:
            raw = response.read()
            return response.code, json.loads(raw) if raw else None
    def login(self, username, password="demo123"):
        return self.request_json(
            "POST", "/api/login", {"username": username, "password": password}

        )
    def test_waiter_order_is_routed_to_bar_and_kitchen(self):
        status, session = self.login("waiter")
        self.assertEqual(status, 200)
        self.assertEqual(session["user"]["role"], "waiter")
        status, menu = self.request_json("GET", "/api/menu")
        self.assertEqual(status, 200)
        cola = next(item for item in menu["items"] if item["name"] == "Coca-Cola")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        status, created = self.request_json(
            "POST",

            "/api/orders",

            {
                "table_id": 1,

                "items": [
                    {"menu_item_id": cola["id"], "quantity": 2},

                    {
                        "menu_item_id": pizza["id"],

                        "quantity": 2,

                        "allergies": ["Млечни производи"],

                        "removals": ["босилек"],

                    },

                ],

            },

        )
        self.assertEqual(status, 201)
        self.assertEqual(created["table"]["number"], 1)
        self.assertEqual(len(created["items"]), 2)
        self.login("kitchen")
        status, kitchen = self.request_json("GET", "/api/stations/kitchen/queue")
        self.assertEqual(status, 200)
        self.assertEqual([item["name"] for item in kitchen["items"]], ["Margherita"])
        self.assertEqual(kitchen["items"][0]["quantity"], 2)
        self.assertEqual(kitchen["items"][0]["status"], "needs_confirmation")
        self.assertEqual(kitchen["items"][0]["allergies"], ["Млечни производи"])
        self.assertEqual(kitchen["items"][0]["removals"], ["босилек"])
        self.login("bar")
        status, bar = self.request_json("GET", "/api/stations/bar/queue")
        self.assertEqual(status, 200)
        self.assertEqual([item["name"] for item in bar["items"]], ["Coca-Cola"])
        self.assertEqual(bar["items"][0]["quantity"], 2)
        self.login("waiter")
        self.request_json(
            "POST", "/api/orders", {"table_id": 1, "items": [{"menu_item_id": cola["id"], "quantity": 1}]}

        )
        _, history = self.request_json("GET", "/api/orders?table_id=1")
        self.assertEqual(len(history["orders"]), 2)
        self.assertNotEqual(history["orders"][0]["id"], history["orders"][1]["id"])
        self.assertTrue(all(order["items"] for order in history["orders"]))
    def test_kitchen_can_complete_a_quantity_in_parts_and_waiter_sees_history(self):
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        status, order = self.request_json(
            "POST",

            "/api/orders",

            {"table_id": 1, "items": [{"menu_item_id": pizza["id"], "quantity": 2}]},

        )
        self.assertEqual(status, 201)
        item_id = order["items"][0]["id"]
        self.login("kitchen")
        status, preparing = self.request_json(
            "PATCH", f"/api/items/{item_id}", {"action": "start"}

        )
        self.assertEqual(status, 200)
        self.assertEqual(preparing["status"], "preparing")
        status, partial = self.request_json(
            "PATCH",

            f"/api/items/{item_id}",

            {"action": "ready", "quantity": 1},

        )
        self.assertEqual(status, 200)
        self.assertEqual(partial["status"], "preparing")
        self.assertEqual(partial["ready_quantity"], 1)
        status, ready = self.request_json(
            "PATCH",

            f"/api/items/{item_id}",

            {"action": "ready", "quantity": 1},

        )
        self.assertEqual(status, 200)
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["ready_quantity"], 2)
        self.login("waiter")
        status, history = self.request_json("GET", "/api/orders?table_id=1")
        self.assertEqual(status, 200)
        self.assertEqual(len(history["orders"]), 1)
        self.assertEqual(history["orders"][0]["status"], "completed")
        self.assertEqual(history["orders"][0]["items"][0]["status"], "ready")
        self.assertEqual(history["orders"][0]["items"][0]["ready_quantity"], 2)
        status, partial_delivery = self.request_json(
            "PATCH", f"/api/items/{item_id}", {"action": "deliver", "quantity": 1}

        )
        self.assertEqual(status, 200)
        self.assertEqual(partial_delivery["delivered_quantity"], 1)
        _, ready = self.request_json("GET", "/api/ready")
        self.assertEqual(ready["items"][0]["id"], item_id)
        self.assertEqual(ready["items"][0]["ready_quantity"] - ready["items"][0]["delivered_quantity"], 1)
        _, delivered = self.request_json("PATCH", f"/api/items/{item_id}", {"action": "deliver", "quantity": 1})
        self.assertEqual(delivered["status"], "delivered")
    def test_waiter_cannot_change_station_item_status(self):
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        _, order = self.request_json(
            "POST",

            "/api/orders",

            {"table_id": 1, "items": [{"menu_item_id": pizza["id"], "quantity": 1}]},

        )
        status, result = self.request_json(
            "PATCH", f"/api/items/{order['items'][0]['id']}", {"action": "start"}

        )
        self.assertEqual(status, 403)
        self.assertIn("дозвола", result["error"])
    def test_allergy_requires_station_confirmation_and_notifies_waiter(self):
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        _, order = self.request_json(
            "POST",

            "/api/orders",

            {"table_id": 2, "items": [{"menu_item_id": pizza["id"], "quantity": 1, "allergies": ["млечни производи"]}]},

        )
        item = order["items"][0]
        self.assertEqual(item["status"], "needs_confirmation")
        self.login("kitchen")
        status, result = self.request_json("PATCH", f"/api/items/{item['id']}", {"action": "start"})
        self.assertEqual(status, 409)
        self.assertEqual(result["error"], "Ставката не може да започне во оваа состојба.")
        status, approved = self.request_json(
            "PATCH", f"/api/items/{item['id']}", {"action": "allergy_approve"}

        )
        self.assertEqual(status, 200)
        self.assertEqual(approved["status"], "received")
        _, started = self.request_json("PATCH", f"/api/items/{item['id']}", {"action": "start"})
        self.assertEqual(started["status"], "preparing")
        _, ready = self.request_json("PATCH", f"/api/items/{item['id']}", {"action": "ready"})
        self.assertEqual(ready["status"], "ready")
        self.assertGreater(ready["updated_at"], item["created_at"])
        self.login("waiter")
        _, notifications = self.request_json("GET", "/api/notifications")
        self.assertTrue(any("Потврдена е подготовката" in item["message"] for item in notifications["notifications"]))
        self.assertTrue(any("е готово" in item["message"] for item in notifications["notifications"]))
    def test_station_can_mark_received_item_directly_as_ready_in_one_step(self):
        self.login("waiter")
        status, order = self.request_json(
            "POST",

            "/api/orders",

            {
                "table_id": 1,

                "items": [
                    {
                        "menu_item_id": 4,

                        "quantity": 2,

                        "removals": [],

                        "additions": [],

                        "allergies": [],

                        "note": "",

                    }

                ],

            },

        )
        self.assertEqual(status, 201)
        item = order["items"][0]
        self.assertEqual(item["status"], "received")
        # Kitchen logs in and marks it as ready directly in one click (no intermediate "start" required)
        self.login("kitchen")
        status, ready = self.request_json(
            "PATCH", f"/api/items/{item['id']}", {"action": "ready"}

        )
        self.assertEqual(status, 200)
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["ready_quantity"], 2)
        # Waiter sees ready notification and ready items
        self.login("waiter")
        status, ready_list = self.request_json("GET", "/api/ready")
        self.assertEqual(status, 200)
        self.assertTrue(any(i["id"] == item["id"] for i in ready_list["items"]))
    def test_batch_completion_for_kitchen_and_waiter(self):
        self.login("waiter")
        status, menu = self.request_json("GET", "/api/menu")
        self.assertEqual(status, 200)
        pizzas = [item for item in menu["items"] if item["station"] == "kitchen"]
        self.assertGreaterEqual(len(pizzas), 1)
        status, order = self.request_json(
            "POST",

            "/api/orders",

            {
                "table_id": 2,

                "items": [
                    {"menu_item_id": pizzas[0]["id"], "quantity": 1},

                    {"menu_item_id": pizzas[0]["id"], "quantity": 2},

                ],

            },

        )
        self.assertEqual(status, 201)
        item_ids = [item["id"] for item in order["items"]]
        # Kitchen marks all items as ready via batch API
        self.login("kitchen")
        status, batch_res = self.request_json(
            "PATCH", "/api/items/batch", {"action": "ready", "item_ids": item_ids}

        )
        self.assertEqual(status, 200)
        self.assertEqual(len(batch_res["items"]), 2)
        self.assertTrue(all(item["status"] == "ready" for item in batch_res["items"]))
        # Waiter marks all ready items as delivered via batch API
        self.login("waiter")
        status, deliver_res = self.request_json(
            "PATCH", "/api/items/batch", {"action": "deliver", "item_ids": item_ids}

        )
        self.assertEqual(status, 200)
        self.assertEqual(len(deliver_res["items"]), 2)
        self.assertTrue(all(item["status"] == "delivered" for item in deliver_res["items"]))
    def test_admin_can_manage_menu_tables_and_staff(self):
        self.login("admin")
        status, config = self.request_json("GET", "/api/admin/config")
        self.assertEqual(status, 200)
        self.assertEqual(len(config["tables"]), 8)
        self.assertIn("kitchen", {user["role"] for user in config["users"]})
        status, category = self.request_json("POST", "/api/admin/categories", {"name": "Салати"})
        self.assertEqual(status, 201)
        status, ingredient = self.request_json("POST", "/api/admin/ingredients", {"name": "краставица"})
        self.assertEqual(status, 201)
        status, ingredient = self.request_json("PATCH", f"/api/admin/ingredients/{ingredient['id']}", {"price": 30})
        self.assertEqual(status, 200)
        self.assertEqual(ingredient["price"], 30)
        status, category = self.request_json("PATCH", f"/api/admin/categories/{category['id']}", {"name": "Салати за споделување"})
        self.assertEqual(status, 200)
        self.assertEqual(category["name"], "Салати за споделување")
        status, item = self.request_json(
            "POST",

            "/api/admin/menu",

            {"name": "Шопска салата", "category_id": category["id"], "station": "kitchen", "price": 220, "ingredients": [ingredient["name"]]},

        )
        self.assertEqual(status, 201)
        status, updated = self.request_json(
            "PATCH", f"/api/admin/menu/{item['id']}", {"price": 250, "station": "bar"}

        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["price"], 250)
        self.assertEqual(updated["station"], "bar")
        status, table = self.request_json("POST", "/api/admin/tables", {"number": 9})
        self.assertEqual(status, 201)
        self.assertEqual(table["number"], 9)
        status, new_user = self.request_json(
            "POST", "/api/admin/users", {"username": "newwaiter", "name": "Нова смена", "role": "waiter", "password": "newpass123"}

        )
        self.assertEqual(status, 201)
        self.assertNotIn("password", new_user)
        status, _ = self.request_json("POST", "/api/login", {"username": "newwaiter", "password": "newpass123"})
        self.assertEqual(status, 200)
        status, result = self.request_json("GET", "/api/admin/config")
        self.assertEqual(status, 403)
        self.assertIn("дозвола", result["error"])
    def test_change_after_preparation_starts_waits_for_station_decision(self):
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        _, order = self.request_json(
            "POST", "/api/orders", {"table_id": 3, "items": [{"menu_item_id": pizza["id"], "quantity": 1}]}

        )
        item_id = order["items"][0]["id"]
        self.login("kitchen")
        self.request_json("PATCH", f"/api/items/{item_id}", {"action": "start"})
        self.login("waiter")
        status, request = self.request_json(
            "POST",

            f"/api/items/{item_id}/requests",

            {"action": "amend", "changes": {"note": "малку печена"}},

        )
        self.assertEqual(status, 201)
        self.assertEqual(request["item"]["status"], "needs_confirmation")
        self.assertEqual(request["request"]["status"], "pending")
        self.login("kitchen")
        _, queue = self.request_json("GET", "/api/stations/kitchen/queue")
        queued_item = next(entry for entry in queue["items"] if entry["id"] == item_id)
        self.assertEqual(queued_item["pending_request"]["changes"]["note"], "малку печена")
        status, resolved = self.request_json(
            "POST",

            f"/api/items/{item_id}/requests/{request['request']['id']}/decision",

            {"decision": "approve"},

        )
        self.assertEqual(status, 200)
        self.assertEqual(resolved["status"], "preparing")
        self.assertEqual(resolved["note"], "малку печена")
        self.login("waiter")
        _, history = self.request_json("GET", "/api/orders?table_id=3")
        event_kinds = [event["kind"] for event in history["orders"][0]["events"]]
        self.assertIn("change_requested", event_kinds)
        self.assertIn("change_request_approved", event_kinds)
    def test_unaccepted_item_can_be_changed_or_cancelled_directly(self):
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        _, order = self.request_json(
            "POST", "/api/orders", {"table_id": 4, "items": [{"menu_item_id": pizza["id"], "quantity": 1}]}

        )
        item_id = order["items"][0]["id"]
        status, amended = self.request_json(
            "POST", f"/api/items/{item_id}/requests", {"action": "amend", "changes": {"note": "без сол"}}

        )
        self.assertEqual(status, 200)
        self.assertEqual(amended["item"]["note"], "без сол")
        self.assertEqual(amended["item"]["status"], "received")
        status, cancelled = self.request_json(
            "POST", f"/api/items/{item_id}/requests", {"action": "cancel"}

        )
        self.assertEqual(status, 200)
        self.assertEqual(cancelled["item"]["status"], "cancelled")
    def test_rejected_allergy_item_can_be_adjusted_and_checked_again(self):
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        _, order = self.request_json(
            "POST", "/api/orders", {"table_id": 5, "items": [{"menu_item_id": pizza["id"], "quantity": 1, "allergies": ["млечни производи"]}]}

        )
        item_id = order["items"][0]["id"]
        self.login("kitchen")
        _, rejected = self.request_json("PATCH", f"/api/items/{item_id}", {"action": "allergy_reject"})
        self.assertEqual(rejected["status"], "rejected")
        self.login("waiter")
        status, edited = self.request_json(
            "POST", f"/api/items/{item_id}/requests", {"action": "amend", "changes": {"removals": ["моцарела"], "note": "провери со одговорно лице"}}

        )
        self.assertEqual(status, 200)
        self.assertEqual(edited["item"]["status"], "needs_confirmation")
        self.assertEqual(edited["item"]["allergies"], ["млечни производи"])
        self.login("kitchen")
        _, queue = self.request_json("GET", "/api/stations/kitchen/queue")
        changed = next(entry for entry in queue["items"] if entry["id"] == item_id)
        self.assertEqual(changed["removals"], ["моцарела"])
        _, approved = self.request_json("PATCH", f"/api/items/{item_id}", {"action": "allergy_approve"})
        self.assertEqual(approved["status"], "received")
    def test_extra_ingredient_price_comes_from_admin_catalog(self):
        self.login("admin")
        _, extra = self.request_json("POST", "/api/admin/ingredients", {"name": "дополнително сирење", "price": 40})
        self.login("waiter")
        _, menu = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu["items"] if item["name"] == "Margherita")
        _, order = self.request_json(
            "POST",

            "/api/orders",

            {"table_id": 6, "items": [{"menu_item_id": pizza["id"], "quantity": 1, "additions": [{"name": extra["name"], "price": 1}]}]},

        )
        self.assertEqual(order["items"][0]["unit_price"], 390)
        self.assertEqual(order["items"][0]["additions"], [{"name": extra["name"], "price": 40}])
    def test_super_admin_can_manage_restaurants_and_seed_admins(self):
        self.login("superadmin")
        status, result = self.request_json("GET", "/api/restaurants")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(result["restaurants"]), 1)
        status, created = self.request_json(
            "POST",

            "/api/restaurants",

            {
                "name": "Охридски Бисер",

                "slug": "ohridski-biser",

                "currency": "EUR",

                "admin_username": "ohrid_admin",

                "admin_password": "password123",

            },

        )
        self.assertEqual(status, 201)
        self.assertEqual(created["slug"], "ohridski-biser")
        self.assertEqual(created["currency"], "EUR")
        # Login as the new restaurant admin
        status, login_res = self.request_json("POST", "/api/login", {"username": "ohrid_admin", "password": "password123"})
        self.assertEqual(status, 200)
        self.assertEqual(login_res["user"]["restaurant"]["slug"], "ohridski-biser")
        self.assertEqual(login_res["user"]["restaurant"]["currency"], "EUR")
        # Admin config only shows their own restaurant catalog
        status, config = self.request_json("GET", "/api/admin/config")
        self.assertEqual(status, 200)
        self.assertEqual(config["currency"], "EUR")
        self.assertEqual(len(config["tables"]), 6)  # 6 tables seeded for new restaurant
        # Super admin updates restaurant details and credentials
        self.login("superadmin")
        status, updated_rest = self.request_json(
            "PATCH",

            f"/api/restaurants/{created['id']}",

            {
                "name": "Охридски Бисер Екстра",

                "slug": "ohridski-biser-extra",

                "currency": "USD",

                "admin_username": "ohrid_admin_new",

                "admin_password": "newpassword456",

                "active": True,

            },

        )
        self.assertEqual(status, 200)
        self.assertEqual(updated_rest["name"], "Охридски Бисер Екстра")
        self.assertEqual(updated_rest["slug"], "ohridski-biser-extra")
        self.assertEqual(updated_rest["currency"], "USD")
        # Login with old credentials fails
        status, _ = self.request_json("POST", "/api/login", {"username": "ohrid_admin", "password": "password123"})
        self.assertEqual(status, 401)
        # Login with new credentials succeeds
        status, login_res2 = self.request_json("POST", "/api/login", {"username": "ohrid_admin_new", "password": "newpassword456"})
        self.assertEqual(status, 200)
        self.assertEqual(login_res2["user"]["restaurant"]["slug"], "ohridski-biser-extra")
        self.assertEqual(login_res2["user"]["restaurant"]["currency"], "USD")
    def test_cross_restaurant_data_isolation(self):
        # Create restaurant 2
        self.login("superadmin")
        status, rest2 = self.request_json(
            "POST",

            "/api/restaurants",

            {
                "name": "Битолски Мерак",

                "slug": "bitolski-merak",

                "currency": "MKD",

                "admin_username": "bitola_admin",

                "admin_password": "demo123",

            },

        )
        self.assertEqual(status, 201)
        # Login as bitola admin and create a waiter and a kitchen user
        self.login("bitola_admin", "demo123")
        self.request_json("POST", "/api/admin/users", {"username": "bitola_waiter", "name": "Битолски Келнер", "role": "waiter", "password": "demo123"})
        self.request_json("POST", "/api/admin/users", {"username": "bitola_kitchen", "name": "Битолска Кујна", "role": "kitchen", "password": "demo123"})
        # Waiter in Restaurant 1 creates an order
        self.login("waiter")
        _, menu1 = self.request_json("GET", "/api/menu")
        pizza = next(item for item in menu1["items"] if item["name"] == "Margherita")
        _, order1 = self.request_json("POST", "/api/orders", {"table_id": 1, "items": [{"menu_item_id": pizza["id"], "quantity": 1}]})
        item1_id = order1["items"][0]["id"]
        # Kitchen in Restaurant 2 checks queue - must be EMPTY!
        self.login("bitola_kitchen", "demo123")
        status_q, queue2 = self.request_json("GET", "/api/stations/kitchen/queue")
        self.assertEqual(status_q, 200)
        self.assertEqual(len(queue2["items"]), 0)
        # Waiter in Restaurant 2 tries to view Restaurant 1 table 1 orders - must get 404 (not found in restaurant 2)
        self.login("bitola_waiter", "demo123")
        status, orders_res = self.request_json("GET", "/api/orders?table_id=1")
        self.assertEqual(status, 404)
        # Kitchen in Restaurant 2 tries to PATCH item from Restaurant 1 - must get 404
        self.login("bitola_kitchen", "demo123")
        status, _ = self.request_json("PATCH", f"/api/items/{item1_id}", {"action": "start"})
        self.assertEqual(status, 404)
if __name__ == "__main__":
    unittest.main()
