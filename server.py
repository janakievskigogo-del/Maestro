"""Local HTTP server for the restaurant staff application."""
import json
import mimetypes
import os
import re
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from restaurant import RestaurantService, WorkflowError
ROOT = Path(__file__).resolve().parent
SESSION_COOKIE = "restaurant_session"
def create_server(db_path="restaurant.sqlite3", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", 8000))):
    try:
        service = RestaurantService(db_path)
    except Exception as error:
        print(f"[startup] RestaurantService boot failed: {error}; retrying once...", flush=True)
        time.sleep(0.25)
        service = RestaurantService(db_path)
    class Handler(BaseHTTPRequestHandler):
        server_version = "RestaurantStaff/2.0"
        def log_message(self, format, *args):
            if os.environ.get("RESTAURANT_HTTP_LOG") == "1":
                super().log_message(format, *args)
        def _json_response(self, status, value, extra_headers=None):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if extra_headers:
                for name, value in extra_headers.items():
                    self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)
        def _read_json(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise WorkflowError("Барањето не е валидно.")
            if length < 0 or length > 1_000_000:
                raise WorkflowError("Барањето е преголемо.", 413)
            try:
                return json.loads(self.rfile.read(length) or b"{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise WorkflowError("Податоците не се валиден JSON.")
        def _token(self):
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                return auth[7:].strip()
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get("Cookie", ""))
                return cookie[SESSION_COOKIE].value if SESSION_COOKIE in cookie else None
            except Exception:
                return None
        def _user(self):
            return service.user_for_token(self._token())
        def _require_user(self):
            user = self._user()
            if not user:
                raise WorkflowError("Најавете се за да продолжите.", 401)
            return user
        def _static(self, path_str):
            allowed = {
                "/": "index.html",

                "/index.html": "index.html",

                "/app.js": "app.js",

                "/styles.css": "styles.css",

                "/manifest.json": "manifest.json",

                "/sw.js": "sw.js",

            }

            if path_str in allowed:
                path = ROOT / allowed[path_str]
            elif path_str.startswith("/icons/"):
                icon_name = os.path.basename(path_str)
                path = ROOT / "icons" / icon_name
            elif re.fullmatch(r"/[a-zA-Z0-9_-]+/?", path_str):
                path = ROOT / "index.html"
            else:
                self._json_response(404, {"error": "Страницата не е пронајдена."})
                return
            if not path.is_file():
                self._json_response(404, {"error": "Датотеката не е пронајдена."})
                return
            body = path.read_bytes()
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if mime.startswith("text/") or mime in {"application/javascript", "application/json"}:
                mime += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            # The app shell must never be served stale by the HTTP cache: fixes
            # have to reach waiter/kitchen devices on the next reload. The
            # service worker provides the offline copy.
            if path.name in {"index.html", "app.js", "styles.css"}:
                self.send_header("Cache-Control", "no-store")
            else:
                self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            parsed = urlparse(self.path)
            if not parsed.path.startswith("/api/"):
                self._static(parsed.path)
                return
            try:
                if parsed.path in ("/api/venue", "/api/venue-info"):
                    values = parse_qs(parsed.query)
                    slug = values.get("slug", values.get("venue", values.get("venue_slug", [None])))[0]
                    venue = service.get_venue(slug)
                    if venue:
                        self._json_response(200, {"venue": venue})
                    else:
                        self._json_response(404, {"error": "Ресторанот не е пронајден."})
                    return
                if parsed.path == "/api/waiters":
                    values = parse_qs(parsed.query)
                    venue_slug = values.get("venue", values.get("venue_slug", [None]))[0]
                    result = service.list_active_waiters(venue_slug)
                    self._json_response(200, result)
                    return
                if parsed.path == "/api/venues":
                    values = parse_qs(parsed.query)
                    slug = values.get("slug", values.get("venue", values.get("venue_slug", [None])))[0]
                    if slug:
                        venue = service.get_venue(slug)
                        self._json_response(200, {"venue": venue, "venues": service.list_public_venues()["venues"]})
                    else:
                        result = service.list_public_venues()
                        self._json_response(200, result)
                    return
                if parsed.path == "/api/session":
                    # Not being signed in is a normal state, not an error: the
                    # client probes the session on every cold start.
                    self._json_response(200, {"user": self._user()})
                    return
                user = self._require_user()
                if parsed.path == "/api/restaurants":
                    result = service.list_restaurants(user)
                elif parsed.path == "/api/menu":
                    result = service.menu(user)
                elif parsed.path == "/api/tables":
                    result = service.tables(user)
                elif parsed.path == "/api/orders":
                    values = parse_qs(parsed.query)
                    raw_table_id = values.get("table_id", [None])[0]
                    try:
                        table_id = int(raw_table_id)
                    except (TypeError, ValueError):
                        raise WorkflowError("Изберете валидна маса.")
                    result = service.orders_for_table(user, table_id)
                elif parsed.path == "/api/notifications":
                    result = service.notifications(user)
                elif parsed.path == "/api/ready":
                    result = service.ready_items(user)
                elif parsed.path == "/api/admin/config":
                    result = service.admin_config(user)
                elif parsed.path == "/api/admin/analytics" or parsed.path == "/api/admin/stats":
                    result = service.admin_analytics(user)
                elif parsed.path == "/api/stations/kitchen/queue":
                    result = service.station_queue(user, "kitchen")
                elif parsed.path == "/api/stations/bar/queue":
                    result = service.station_queue(user, "bar")
                else:
                    raise WorkflowError("Ресурсот не е пронајден.", 404)
                self._json_response(200, result)
            except WorkflowError as error:
                self._json_response(error.status, {"error": str(error)})
            except Exception as error:
                print(f"[GET] unhandled error: {error}", flush=True)
                self._json_response(500, {"error": "Серверска грешка. Обидете се повторно."})
        def do_POST(self):
            try:
                path = urlparse(self.path).path
                payload = self._read_json()
                if not isinstance(payload, dict):
                    raise WorkflowError("Податоците за барањето не се во правилен формат.")
                if path in ("/api/login", "/api/auth/login"):
                    venue_slug = payload.get("venueSlug") or payload.get("venue_slug") or payload.get("venue")
                    token, user = service.login(payload.get("username"), payload.get("password"), venue_slug=venue_slug)
                    self._json_response(200, {"user": user, "token": token}, {"Set-Cookie": f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400"})
                    return
                if path == "/api/login/pin":
                    token, user = service.login_pin(payload.get("user_id"), payload.get("pin"))
                    self._json_response(200, {"user": user, "token": token}, {"Set-Cookie": f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400"})
                    return
                if path in ("/api/auth/pin-login", "/api/login/pin/venue"):
                    pin = payload.get("pin")
                    venue_slug = payload.get("venueSlug") or payload.get("venue_slug") or payload.get("venue")
                    token, user = service.login_pin_venue(pin, venue_slug)
                    self._json_response(200, {"user": user, "token": token}, {"Set-Cookie": f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400"})
                    return
                if path == "/api/logout":
                    service.logout(self._token())
                    self._json_response(200, {"ok": True}, {"Set-Cookie": f"{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
                    return
                user = self._require_user()
                if path == "/api/restaurants":
                    result = service.create_restaurant(user, payload)
                    self._json_response(201, result)
                    return
                if path == "/api/orders":
                    result = service.create_order(user, payload)
                    self._json_response(201, result)
                    return
                table_order_match = re.fullmatch(r"/api/tables/(\d+)/orders?", path)
                if table_order_match:
                    payload["table_id"] = int(table_order_match.group(1))
                    result = service.create_order(user, payload)
                    self._json_response(201, result)
                    return
                change_request = re.fullmatch(r"/api/items/(\d+)/requests", path)
                if change_request:
                    result = service.request_item_change(user, int(change_request.group(1)), payload)
                    self._json_response(201 if result["request"] else 200, result)
                    return
                change_decision = re.fullmatch(r"/api/items/(\d+)/requests/(\d+)/decision", path)
                if change_decision:
                    result = service.resolve_item_change(user, int(change_decision.group(1)), int(change_decision.group(2)), payload)
                    self._json_response(200, result)
                    return
                admin_create = {
                    "/api/admin/categories": service.create_category,

                    "/api/admin/ingredients": service.create_ingredient,

                    "/api/admin/menu": service.create_menu_item,

                    "/api/admin/tables": service.create_table,

                    "/api/admin/users": service.create_user,

                }

                if path in admin_create:
                    result = admin_create[path](user, payload)
                    self._json_response(201, result)
                    return
                raise WorkflowError("Ресурсот не е пронајден.", 404)
            except WorkflowError as error:
                self._json_response(error.status, {"error": str(error)})
            except Exception as error:
                print(f"[POST] unhandled error: {error}", flush=True)
                self._json_response(500, {"error": "Серверска грешка. Обидете се повторно."})
        def do_PATCH(self):
            try:
                user = self._require_user()
                path = urlparse(self.path).path
                rest_match = re.fullmatch(r"/api/restaurants/(\d+)", path)
                if rest_match:
                    result = service.update_restaurant(user, int(rest_match.group(1)), self._read_json())
                    self._json_response(200, result)
                    return
                reset_match = re.fullmatch(r"/api/tables/(\d+)/reset", path)
                if reset_match:
                    result = service.reset_table(user, int(reset_match.group(1)))
                    self._json_response(200, result)
                    return
                admin_routes = (
                    (r"/api/admin/menu/(\d+)", service.update_menu_item),

                    (r"/api/admin/categories/(\d+)", service.update_category),

                    (r"/api/admin/ingredients/(\d+)", service.update_ingredient),

                    (r"/api/admin/tables/(\d+)", service.update_table),

                    (r"/api/admin/users/(\d+)", service.update_user),

                )
                for pattern, update in admin_routes:
                    match = re.fullmatch(pattern, path)
                    if match:
                        result = update(user, int(match.group(1)), self._read_json())
                        self._json_response(200, result)
                        return
                if path == "/api/items/batch":
                    result = service.update_items_batch(user, self._read_json())
                    self._json_response(200, result)
                    return
                match = re.fullmatch(r"/api/items/(\d+)", path)
                if not match:
                    raise WorkflowError("Ресурсот не е пронајден.", 404)
                result = service.update_item(user, int(match.group(1)), self._read_json())
                self._json_response(200, result)
            except WorkflowError as error:
                self._json_response(error.status, {"error": str(error)})
            except Exception as error:
                print(f"[PATCH] unhandled error: {error}", flush=True)
                self._json_response(500, {"error": "Серверска грешка. Обидете се повторно."})
        def do_DELETE(self):
            self._json_response(405, {"error": "Методот не е дозволен."})
    http_server = ThreadingHTTPServer((host, port), Handler)
    http_server.restaurant_service = service
    return http_server
def main():
    missing = [name for name in ("index.html", "app.js", "styles.css") if not (ROOT / name).is_file()]
    if missing:
        print(f"[startup] Missing app shell files: {', '.join(missing)}", flush=True)
        raise SystemExit(1)
    port = int(os.environ.get("PORT", "8000"))
    db_path = os.environ.get("RESTAURANT_DB", str(ROOT / "restaurant.sqlite3"))
    try:
        http_server = create_server(db_path=db_path, host=os.environ.get("HOST", "127.0.0.1"), port=port)
    except Exception as error:
        print(f"[startup] server failed to start: {error}", flush=True)
        raise SystemExit(1)
    print(f"Restaurant app running at http://{http_server.server_address[0]}:{http_server.server_address[1]}", flush=True)
    try:
        http_server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping restaurant app.")
    finally:
        http_server.server_close()
if __name__ == "__main__":
    main()
