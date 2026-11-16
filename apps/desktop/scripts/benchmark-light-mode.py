"""Measure production canvas components in an isolated Chromium fixture.

Requires Python 3.10+, psutil and websockets. See docs/verification/desktop-light-mode.md.
"""

import argparse
import asyncio
import functools
import http.server
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
import psutil
import websockets

class CDP:

    def __init__(self, url):
        self.url = url
        self.seq = 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url, max_size=100 * 1024 * 1024)
        return self

    async def __aexit__(self, *args):
        await self.ws.close()

    async def call(self, method, params=None):
        self.seq += 1
        seq = self.seq
        await self.ws.send(json.dumps({'id': seq, 'method': method, 'params': params or {}}))
        while True:
            r = json.loads(await asyncio.wait_for(self.ws.recv(), 40))
            if r.get('id') == seq:
                if 'error' in r:
                    raise RuntimeError(r['error'])
                return r.get('result', {})

    async def evaluate(self, expr):
        r = await self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'])
        return r.get('result', {}).get('value')
parser = argparse.ArgumentParser(description="Compare a synthetic UI with WebView2's reduced-motion Chromium switch.")
parser.add_argument('--browser', required=True, help='Path to an Edge/Chromium executable')
parser.add_argument('--fixture-dir', type=Path, required=True, help='Directory containing the bundled index.html')
parser.add_argument('--output', type=Path, default=Path('light-benchmark.json'))
args = parser.parse_args()
ROOT = args.fixture_dir.resolve()

class Quiet(http.server.SimpleHTTPRequestHandler):

    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
browser = args.browser

def cpu(proc):
    total = 0
    for p in [proc, *proc.children(recursive=True)]:
        try:
            t = p.cpu_times()
            total += t.user + t.system
        except psutil.Error:
            pass
    return total

async def sample(on, number):
    profile_dir = tempfile.TemporaryDirectory(prefix='light-mode-benchmark-')
    profile = profile_dir.name
    args = [browser, '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1280,900', 'about:blank']
    if on:
        args.insert(-1, '--force-prefers-reduced-motion')
    p = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    proc = psutil.Process(p.pid)
    try:
        f = Path(profile) / 'DevToolsActivePort'
        for _ in range(150):
            if f.exists():
                break
            await asyncio.sleep(0.1)
        port = int(f.read_text().splitlines()[0])
        base = 'http://127.0.0.1:' + str(port)
        targets = json.load(urllib.request.urlopen(base + '/json/list'))
        target = next((t for t in targets if t['type'] == 'page'))
        async with CDP(target['webSocketDebuggerUrl']) as c:
            version = await c.call('Browser.getVersion')
            await c.call('Page.enable')
            await c.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.paintCounts={clearRect:0,putImageData:0};for(const method of Object.keys(window.paintCounts)){const original=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){window.paintCounts[method]++;return original.apply(this,args)}}'})
            await c.call('Performance.enable')
            await c.call('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/index.html'})
            for _ in range(100):
                if await c.evaluate("document.querySelectorAll('canvas').length>=25"):
                    break
                await asyncio.sleep(0.1)
            await asyncio.sleep(3)
            before = await c.evaluate("({counts:{...paintCounts},reduce:matchMedia('(prefers-reduced-motion:reduce)').matches,canvases:document.querySelectorAll('canvas').length,visibility:document.visibilityState,button:document.querySelector('button')?.textContent})")
            assert before['canvases'] >= 25, before
            assert before['reduce'] == on, before

            async def task():
                return next((x['value'] for x in (await c.call('Performance.getMetrics'))['metrics'] if x['name'] == 'TaskDuration'))
            c0 = cpu(proc)
            t0 = await task()
            start = time.perf_counter()
            await asyncio.sleep(8)
            elapsed = time.perf_counter() - start
            td = await task() - t0
            cd = cpu(proc) - c0
            after = await c.evaluate('({...paintCounts})')
            await c.evaluate("document.querySelector('button').click()")
            await asyncio.sleep(0.15)
            button = await c.evaluate("document.querySelector('button').textContent")
            assert button == 'Clicks: 1', button
            result = {'run': number, 'lightweight': on, 'browser': version['product'], 'logical_cpus': psutil.cpu_count(), 'seconds': round(elapsed, 3), 'canvas_count': before['canvases'], 'canvas_calls': {k: after[k] - v for k, v in before['counts'].items()}, 'renderer_task_ms': round(td * 1000, 2), 'browser_tree_cpu_seconds': round(cd, 3), 'cpu_percent_one_core': round(cd / elapsed * 100, 2), 'interaction_passed': True}
            print(json.dumps(result), flush=True)
            return result
    finally:
        try:
            for child in proc.children(recursive=True):
                try:
                    child.terminate()
                except psutil.Error:
                    pass
            proc.terminate()
        except psutil.Error:
            pass
        try:
            p.wait(timeout=10)
            profile_dir.cleanup()
        except (OSError, subprocess.TimeoutExpired):
            pass

async def main():
    results = []
    for i, on in enumerate([False, True, False, True, False, True], 1):
        results.append(await sample(on, i))
    args.output.write_text(json.dumps(results, indent=2), encoding='utf-8')
    server.shutdown()
if __name__ == '__main__':
    asyncio.run(main())
