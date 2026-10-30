import { Socket } from 'node:net';

// Test/preload fence: permit own loopback servers and IPC, never external providers or DNS.
const local = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]));
  if (!local(url.hostname)) throw new Error('Offline checks block external fetch');
  return Reflect.apply(nativeFetch, globalThis, args);
};
const nativeConnect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = input && typeof input === 'object' ? input : {};
  const host =
    options.host ?? options.hostname ?? (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (!options.path && !local(String(host)))
    throw new Error('Offline checks block external sockets');
  return Reflect.apply(nativeConnect, this, args);
};
