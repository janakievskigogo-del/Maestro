import sqlite3, secrets, sys, json
sys.stdout.reconfigure(encoding='utf-8')
from restaurant import _hash_password

conn = sqlite3.connect('c:/kiko gogo biznis/restaurant.sqlite3')
conn.row_factory = sqlite3.Row

# 1. Activate all admin and super_admin accounts
conn.execute("UPDATE users SET active=1 WHERE role IN ('admin', 'super_admin')")
conn.commit()

users = conn.execute("""
    SELECT u.id, u.username, u.display_name, u.role, u.salt, u.password_hash, u.pin, u.pin_code, u.restaurant_id, r.name as rest_name, r.slug as rest_slug 
    FROM users u 
    LEFT JOIN restaurants r ON r.id = u.restaurant_id 
    WHERE u.role IN ('admin', 'super_admin')
""").fetchall()

test_passwords = [
    'Admin123!', 'admin123', 'admin', 'password', 'Maestro123!', '12345678', '1234',
    'GogoPass2026!', 'KikoPass2026!', 'EderaPass123!', 'OhridPass123!', 'SkopjePass123!',
    'demo', 'adminpass', 'Admin2026!', 'SuperAdmin123!', 'admin1234', 'adminadmin', 'admin!123',
    'AdminPass123!'
]

results = []
for u in users:
    found = None
    for p in test_passwords:
        if _hash_password(p, u['salt']) == u['password_hash']:
            found = p
            break
    results.append({
        'id': u['id'],
        'username': u['username'],
        'role': u['role'],
        'display_name': u['display_name'],
        'venue': u['rest_name'] or 'Сите (Super Admin)',
        'venue_slug': u['rest_slug'],
        'pin': u['pin_code'] or u['pin'],
        'password': found
    })

with open('c:/kiko gogo biznis/admin_accounts_out.json', 'w', encoding='utf-8') as out:
    json.dump(results, out, ensure_ascii=False, indent=2)

print("Saved admin_accounts_out.json")
