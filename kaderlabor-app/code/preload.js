// Brücke zwischen Seite und Hauptprozess. Nur die lokal mitgelieferte Seite (file://) bekommt sie,
// nie eine Seite aus dem Internet – so kann keine fremde Seite den API-Schlüssel nutzen.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  // Daten aus dem FC-27-Abgleich puffern, bis die Seite bereit ist
  let fcData = null, fcDataCb = null, fcStatusCb = null;
  ipcRenderer.on("fc:data", (_e, d) => { if (fcDataCb) fcDataCb(d); else fcData = d; });
  ipcRenderer.on("fc:status", (_e, s) => { if (fcStatusCb) fcStatusCb(s); });
  contextBridge.exposeInMainWorld("kaderlaborNative", {
    sample: (payload) => ipcRenderer.invoke("claude:sample", payload),
    hasKey: () => ipcRenderer.invoke("settings:hasKey"),
    setKey: (key) => ipcRenderer.invoke("settings:setKey", key),
    storeGet: () => ipcRenderer.invoke("store:get"),
    storeSet: (data) => ipcRenderer.invoke("store:set", data),
    fc: {
      status: () => ipcRenderer.invoke("fc:status"),
      chooseFolder: () => ipcRenderer.invoke("fc:chooseFolder"),
      chooseNames: () => ipcRenderer.invoke("fc:chooseNames"),
      syncNow: () => ipcRenderer.invoke("fc:syncNow"),
      setOptions: (o) => ipcRenderer.invoke("fc:setOptions", o),
      onData: (cb) => { fcDataCb = cb; if (fcData) { const d = fcData; fcData = null; cb(d); } },
      onStatus: (cb) => { fcStatusCb = cb; },
    },
  });
}
