// (fork "wishes") For a second display check at the same time (check.mjs --port-offset N): loaded before the backend
// (NODE_OPTIONS --import), it moves every port the backend listens on by N (8200 -> 8200+N, 8201 -> 8201+N, ...) and its
// requests to itself (fetch to localhost:8200 / 127.0.0.1:8200) along with them. The backend's code stays as it is.
import net from 'node:net'

const offset = Number(process.env.DISPLAY_CHECK_PORT_OFFSET) || 0

if (offset) {
  const shift = (port) => (typeof port === 'number' && port > 0 ? port + offset : port)
  const listen = net.Server.prototype.listen
  net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number') args[0] = shift(args[0])
    else if (typeof args[0] === 'string' && /^\d+$/.test(args[0])) args[0] = shift(Number(args[0]))
    else if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) args[0] = { ...args[0], port: shift(Number(args[0].port)) }
    return listen.apply(this, args)
  }
  const fetchOf = globalThis.fetch
  const self = /^(https?:\/\/(?:localhost|127\.0\.0\.1)):(8\d{3})(?=[/?#]|$)/
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) {
      const url = String(input)
      const m = self.exec(url)
      if (m) return fetchOf(url.replace(self, `${m[1]}:${Number(m[2]) + offset}`), init)
    }
    return fetchOf(input, init)
  }
}
