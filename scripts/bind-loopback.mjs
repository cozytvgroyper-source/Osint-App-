// Preload for services Public Desk starts but does not own (for example the bundled Open OSINT data
// service, which calls server.listen(port) and so listens on every network interface, reachable from the
// rest of the Wi-Fi network). Loaded with `node --import`, it makes any server that names no address listen
// on 127.0.0.1 only. Servers that choose an address on purpose are left alone.
import net from 'node:net';

const LOOPBACK = '127.0.0.1';
const originalListen = net.Server.prototype.listen;

function isPort(value) {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));
}

net.Server.prototype.listen = function listenOnLoopbackByDefault(...args) {
  const [first] = args;
  if (first === undefined || typeof first === 'function') {
    args.unshift(0, LOOPBACK);
  } else if (isPort(first)) {
    if (typeof args[1] !== 'string') args.splice(1, 0, LOOPBACK);
  } else if (first && typeof first === 'object' && 'port' in first && first.host === undefined && first.path === undefined) {
    args[0] = { ...first, host: LOOPBACK };
  }
  return originalListen.apply(this, args);
};
