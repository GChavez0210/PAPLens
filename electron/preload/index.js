const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cpapAPI", {
  selectDataFolder: () => ipcRenderer.invoke("cpap:select-data-folder"),
  loadDataFolder: (folderPath) => ipcRenderer.invoke("cpap:load-data-folder", folderPath),
  getSummary: () => ipcRenderer.invoke("cpap:get-summary"),
  getDailyStats: () => ipcRenderer.invoke("cpap:get-daily-stats"),
  getSessionDetail: (sessionId) => ipcRenderer.invoke("cpap:get-session-detail", sessionId),
  refresh: () => ipcRenderer.invoke("cpap:refresh"),
  saveReport: (reportData) => ipcRenderer.invoke("cpap:save-report", reportData),
  setTimeFilter: (dayStartHour, dayEndHour) =>
    ipcRenderer.invoke("cpap:set-time-filter", dayStartHour, dayEndHour),
  getLastDataPath: () => ipcRenderer.invoke("app:get-last-data-path"),
  getProfiles: () => ipcRenderer.invoke("app:get-profiles"),
  createProfile: (profileData) => ipcRenderer.invoke("app:create-profile", profileData),
  deleteProfile: (profileId) => ipcRenderer.invoke("app:delete-profile", profileId),
  setActiveProfile: (profileId) => ipcRenderer.invoke("app:set-active-profile", profileId),
  getActiveProfile: () => ipcRenderer.invoke("app:get-active-profile"),
  getLastNightOverview: () => ipcRenderer.invoke("cpap:get-last-night-overview"),
  getInsights: (payload) => ipcRenderer.invoke("cpap:get-insights", payload),
  onDataLoaded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cpap:data-loaded", listener);
    return () => ipcRenderer.removeListener("cpap:data-loaded", listener);
  }
});

contextBridge.exposeInMainWorld("diagAPI", {
  resolveHost: (hostname) => ipcRenderer.invoke("diag:resolve-host", hostname),
  tcpProbe: (host, port, timeoutMs = 3000) => ipcRenderer.invoke("diag:tcp-probe", host, port, timeoutMs),
  nodeVersion: () => ipcRenderer.invoke("diag:node-version")
});
