"""Mock Evolution API: logs sendText calls to stdout and mock_sends.log. python scripts/mock_evolution.py"""
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG = open('/tmp/mock_sends.log', 'a')

class H(BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        entry = {'path': self.path, 'body': body.decode(errors='replace'), 'ts': time.time()}
        print(json.dumps(entry), flush=True)
        LOG.write(json.dumps(entry) + '\n'); LOG.flush()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8081), H).serve_forever()
