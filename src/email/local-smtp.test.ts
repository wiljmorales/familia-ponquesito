import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { defaultEmailClient } from "./client";

const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_APP_PASSWORD", "EMAIL_FROM"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("SMTP local desechable", () => {
  it("solo entrega a un receptor .invalid y puede reintentar después de un fallo", async () => {
    const accepted: string[] = [];
    let rejectFirst = true;
    const server = createServer((socket) => {
      socket.write("220 local.test ESMTP\r\n");
      let buffered = "";
      let dataMode = false;
      let message = "";
      socket.on("data", (chunk) => {
        buffered += chunk.toString();
        while (buffered.includes("\r\n")) {
          const boundary = buffered.indexOf("\r\n");
          const line = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (dataMode) {
            if (line === ".") {
              dataMode = false;
              if (rejectFirst) {
                rejectFirst = false;
                socket.write("451 temporary local failure\r\n");
              } else {
                accepted.push(message);
                socket.write("250 accepted locally\r\n");
              }
              message = "";
            } else message += `${line}\n`;
          } else if (/^EHLO /i.test(line)) socket.write("250-local.test\r\n250 AUTH PLAIN\r\n");
          else if (/^AUTH PLAIN /i.test(line)) socket.write("235 local auth accepted\r\n");
          else if (/^MAIL FROM:/i.test(line)) socket.write("250 sender accepted\r\n");
          else if (/^RCPT TO:<synthetic@example\.invalid>/i.test(line)) socket.write("250 recipient accepted\r\n");
          else if (/^RCPT TO:/i.test(line)) socket.write("550 real recipient forbidden\r\n");
          else if (line === "DATA") { dataMode = true; socket.write("354 send data\r\n"); }
          else if (line === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
          else socket.write("500 unsupported\r\n");
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Puerto SMTP local inválido");
      Object.assign(process.env, {
        SMTP_HOST: "127.0.0.1", SMTP_PORT: String(address.port), SMTP_SECURE: "false",
        SMTP_USER: "synthetic@example.invalid", SMTP_APP_PASSWORD: "synthetic-only",
        EMAIL_FROM: "synthetic@example.invalid",
      });
      const input = { to: "synthetic@example.invalid", subject: "Prueba sintética", text: "Hola local", html: "<p>Hola local</p>" };
      expect((await defaultEmailClient().send(input)).ok).toBe(false);
      expect((await defaultEmailClient().send(input)).ok).toBe(true);
      expect(accepted).toHaveLength(1);
      expect(accepted[0]).toContain("Hola local");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);
});
