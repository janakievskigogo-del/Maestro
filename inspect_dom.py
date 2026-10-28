import sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')

res = subprocess.run([
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '--headless=new',
    '--disable-gpu',
    '--dump-dom',
    'http://127.0.0.1:8000/?venue=maestro-skopje'
], capture_output=True)

stdout = res.stdout.decode('utf-8', errors='replace')
print('DOM Output length:', len(stdout))
app_idx = stdout.find('id="app"')
print(stdout[app_idx-50:app_idx+500])
