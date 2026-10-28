import sys, subprocess, time, json, urllib.request, asyncio, websockets
sys.stdout.reconfigure(encoding='utf-8')

async def main():
    proc = subprocess.Popen([
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        '--headless=new',
        '--disable-gpu',
        '--remote-debugging-port=9222',
        '--user-data-dir=c:\\kiko gogo biznis\\.edge_debug_profile',
        'http://127.0.0.1:8000/?venue=maestro-skopje'
    ])
    await asyncio.sleep(2.0)
    try:
        tabs = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json/list').read())
        page_tab = [t for t in tabs if 'venue=' in t.get('url', '')][0]
        ws_url = page_tab['webSocketDebuggerUrl']
        print('Connecting to:', ws_url)
        
        async with websockets.connect(ws_url) as ws:
            # Enable Runtime and Log
            await ws.send(json.dumps({'id': 1, 'method': 'Runtime.enable'}))
            await ws.send(json.dumps({'id': 2, 'method': 'Log.enable'}))
            await ws.send(json.dumps({'id': 3, 'method': 'Page.enable'}))
            
            # Reload page to capture all console events from the beginning
            await ws.send(json.dumps({'id': 4, 'method': 'Page.reload'}))
            
            start = time.time()
            while time.time() - start < 4.0:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    data = json.loads(msg)
                    method = data.get('method', '')
                    if 'exception' in method.lower() or 'error' in method.lower() or 'console' in method.lower() or 'log' in method.lower():
                        print('EVENT:', method, json.dumps(data.get('params', {}), ensure_ascii=False))
                    elif 'result' in data and 'exceptionDetails' in data['result']:
                        print('EXCEPTION:', json.dumps(data['result']['exceptionDetails'], ensure_ascii=False))
                except asyncio.TimeoutError:
                    pass
            
            # Check document.querySelector('#app').innerHTML
            eval_req = {
                'id': 100,
                'method': 'Runtime.evaluate',
                'params': {'expression': 'document.querySelector("#app").innerHTML'}
            }
            await ws.send(json.dumps(eval_req))
            res = await ws.recv()
            print('APP INNER_HTML:', json.dumps(json.loads(res).get('result', {}), ensure_ascii=False))

    finally:
        proc.terminate()

asyncio.run(main())
