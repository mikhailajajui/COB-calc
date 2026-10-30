// SEC-5b / SEC-5c test support (QA-owned; the developer must not edit this file). Loaded into a ui/serve.mjs child with
// `node --import <this file> ui/serve.mjs` by tests/tooling/sec5b-serve-hardening.test.ts and
// tests/tooling/sec5c-serve-close.test.ts. It changes nothing in
// serve.mjs; it only observes the http.Server that serve.mjs creates, by wrapping net.Server.prototype.listen:
//   SEC5B_REPORT=1            print one line "SEC5B-OPTIONS <json>" with requireHostHeader, keepAliveTimeout,
//                             headersTimeout and requestTimeout as the server holds them (T5b-TIMEOUTS).
//   SEC5B_EMIT_CODE=<code>    on every new connection, emit the server's own 'clientError' event once with an
//                             Error whose code is <code> and that connection's socket, before any byte is read or
//                             written, so the reply for codes that cannot be probed live in a test (408, 413) is
//                             checked on the wire (R5b-1). With no 'clientError' listener nothing is sent.
//   SEC5C_REPORT_CLOSE=1      (SEC-5c, T5c-HALFOPEN, T5c-NOTRUNC) for every server socket, print one line
//                             "SEC5C-CLOSE <ms from 'connection' to the socket's 'close'> finished=<true|false>"
//                             when the server's socket closes, so a test can see from the server side that the socket
//                             has been released (a client cannot tell passively, and writing to it would itself
//                             trigger a close). finished is socket.writableFinished at 'close': true when every byte
//                             written to the socket had been handed to the OS ('finish') before it was destroyed.
import { Server as HttpServer } from 'node:http';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function patchedListen(...args) {
  if (this instanceof HttpServer) {
    if (process.env.SEC5B_REPORT === '1') {
      const o = {
        requireHostHeader: this.requireHostHeader,
        keepAliveTimeout: this.keepAliveTimeout,
        headersTimeout: this.headersTimeout,
        requestTimeout: this.requestTimeout,
      };
      process.stdout.write(`SEC5B-OPTIONS ${JSON.stringify(o)}\n`);
    }
    if (process.env.SEC5C_REPORT_CLOSE === '1') {
      this.prependListener('connection', (socket) => {
        const t0 = performance.now();
        socket.once('close', () => {
          process.stdout.write(`SEC5C-CLOSE ${Math.round(performance.now() - t0)} finished=${socket.writableFinished}\n`);
        });
      });
    }
    const code = process.env.SEC5B_EMIT_CODE;
    if (code) {
      this.prependListener('connection', (socket) => {
        setImmediate(() => {
          const err = new Error(`sec5b probe ${code}`);
          err.code = code;
          this.emit('clientError', err, socket);
        });
      });
    }
  }
  return listen.apply(this, args);
};
