import sqlite3
from restaurant import _hash_password

conn = sqlite3.connect('c:/kiko gogo biznis/restaurant.sqlite3')
conn.row_factory = sqlite3.Row
users = conn.execute("SELECT id, username, salt, password_hash FROM users WHERE username IN ('admin', 'admin_1792720472', 'Edera_admin360')").fetchall()

for u in users:
    for cand in ['demo123', 'admin', 'admin123', 'Admin123!', '1234', '123456', '12345678', 'password', 'Maestro123!']:
        if _hash_password(cand, u['salt']) == u['password_hash']:
            print(f"{u['username']}: {cand}")
            break
    else:
        print(f"{u['username']}: password not in common list")
