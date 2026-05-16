import { contextBridge, ipcRenderer } from 'electron';

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', withPrototype(ipcRenderer));

// `exposeInMainWorld` can't detect attributes and methods of `prototype`, manually patching into object
function withPrototype(obj: Record<string, any>) {
  const protos = Object.getPrototypeOf(obj);

  for (const [key, value] of Object.entries(protos)) {
    if (typeof value === 'function') {
      obj[key] = value.bind(obj);
    }
  }

  return obj;
}
