import sqlite3
from restaurant import _hash_password

conn = sqlite3.connect('c:/kiko gogo biznis/restaurant.sqlite3')
conn.row_factory = sqlite3.Row
users = conn.execute("SELECT id, username, salt, password_hash FROM users WHERE username IN ('admin', 'Edera_admin360')").fetchall()

candidates = [
    'admin', 'admin123', 'Admin123!', 'AdminPass123!', 'demo123', 'password', '123456', '12345678',
    'edera', 'edera123', 'edera360', 'Edera360', 'Edera360!', 'EderaPass123!', 'ederaadmin',
    'SkopjePass123!', 'Maestro123!', 'admin_skopje', 'Admin2026!', 'Admin!2026', 'admin.skopje',
    'admin.edera', 'admin.ohrid', 'SuperAdmin123!'
]

for u in users:
    matched = None
    for c in candidates:
        if _hash_password(c, u['salt']) == u['password_hash']:
            matched = c
            break
    print(u['username'], '=>', matched)
