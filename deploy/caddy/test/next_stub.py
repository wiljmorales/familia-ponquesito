"""Sustituto de Next.js para la prueba local: responde 200 con el método y la
ruta recibidos y registra cada petición, para comprobar qué llega a Next.js."""

import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG = sys.argv[2]


class Stub(BaseHTTPRequestHandler):
    def _reply(self):
        with open(LOG, "a") as f:
            f.write(f"{self.command} {self.path}\n")
        body = f"next-stub {self.command} {self.path}".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _reply

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(sys.argv[1])), Stub).serve_forever()
