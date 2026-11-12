// Brücke zwischen Seite und Hauptprozess. Die Seite bekommt nur diese drei Funktionen.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kaderlaborNative", {
  sample: (payload) => ipcRenderer.invoke("claude:sample", payload),
  hasKey: () => ipcRenderer.invoke("settings:hasKey"),
  setKey: (key) => ipcRenderer.invoke("settings:setKey", key),
});
