// Brücke zwischen Seite und Hauptprozess. Nur die lokal mitgelieferte Seite (file://) bekommt sie,
// nie eine Seite aus dem Internet – so kann keine fremde Seite den API-Schlüssel nutzen.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("kaderlaborNative", {
    sample: (payload) => ipcRenderer.invoke("claude:sample", payload),
    hasKey: () => ipcRenderer.invoke("settings:hasKey"),
    setKey: (key) => ipcRenderer.invoke("settings:setKey", key),
    storeGet: () => ipcRenderer.invoke("store:get"),
    storeSet: (data) => ipcRenderer.invoke("store:set", data),
  });
}
