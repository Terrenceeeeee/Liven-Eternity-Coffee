'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('liven', {
  // settings / state
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: (settings) => ipcRenderer.invoke('settings:save', settings),
  petScale: (value) => ipcRenderer.invoke('pet:scale', value),
  appState: () => ipcRenderer.invoke('app:state'),
  onSettingsChanged: (cb) => on('settings:changed', cb),

  // setup / first run
  setupGet: () => ipcRenderer.invoke('setup:get'),
  setupPickOutDir: (current) => ipcRenderer.invoke('setup:pick-outdir', current),
  setupComplete: (payload) => ipcRenderer.invoke('setup:complete', payload),
  setupSkip: () => ipcRenderer.invoke('setup:skip'),
  openSetup: () => ipcRenderer.invoke('setup:open'),
  privacyClear: (what) => ipcRenderer.invoke('privacy:clear', what),

  // chat
  chatHistory: () => ipcRenderer.invoke('chat:history'),
  chatSend: (text, link) => ipcRenderer.invoke('chat:send', { text, link }),
  chatReset: () => ipcRenderer.invoke('chat:reset'),
  onChatDelta: (cb) => on('chat:delta', cb),
  onThinking: (cb) => on('pet:thinking', cb),

  // llm
  llmTest: (cfg) => ipcRenderer.invoke('llm:test', cfg),

  // writing
  writeGenerate: (payload) => ipcRenderer.invoke('write:generate', payload),
  writePrompt: (payload) => ipcRenderer.invoke('write:prompt', payload),
  writeSave: (payload) => ipcRenderer.invoke('write:save', payload),
  writeParse: (payload) => ipcRenderer.invoke('write:parse', payload),
  onWriteDelta: (cb) => on('write:delta', cb),

  // works
  worksList: () => ipcRenderer.invoke('works:list'),
  worksRead: (file) => ipcRenderer.invoke('works:read', file),
  worksReveal: (file) => ipcRenderer.invoke('works:reveal', file),
  worksOpen: (file) => ipcRenderer.invoke('works:open', file),
  worksDelete: (file) => ipcRenderer.invoke('works:delete', file),
  onWorksChanged: (cb) => on('works:changed', cb),

  // library
  librarySearch: (payload) => ipcRenderer.invoke('library:search', payload),
  libraryOpen: (payload) => ipcRenderer.invoke('library:open', payload),
  libraryProgress: (payload) => ipcRenderer.invoke('library:progress', payload),
  libraryRecent: () => ipcRenderer.invoke('library:recent'),
  libraryImport: () => ipcRenderer.invoke('library:import'),

  // schedule
  scheduleStatus: () => ipcRenderer.invoke('schedule:status'),
  scheduleRun: () => ipcRenderer.invoke('schedule:run'),
  readingRun: () => ipcRenderer.invoke('reading:run'),
  readingList: () => ipcRenderer.invoke('reading:list'),
  serialStatus: () => ipcRenderer.invoke('serial:status'),
  serialRun: () => ipcRenderer.invoke('serial:run'),
  serialRead: (file) => ipcRenderer.invoke('serial:read', file),
  serialOpen: () => ipcRenderer.invoke('serial:open'),

  // app
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openFolder: (which) => ipcRenderer.invoke('app:open-folder', which),
  pickCharacter: () => ipcRenderer.invoke('app:pick-character'),
  openStudio: (section) => ipcRenderer.invoke('app:open-studio', section),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  onGoto: (cb) => on('ui:goto', cb),

  // pet
  petLine: (opts) => ipcRenderer.invoke('pet:line', opts),
  petSay: (text) => ipcRenderer.invoke('pet:say', text),
  petDragStart: (p) => ipcRenderer.send('pet:drag-start', p),
  petDragEnd: () => ipcRenderer.send('pet:drag-end'),
  petMenu: () => ipcRenderer.send('pet:menu'),
  onPetLine: (cb) => on('pet:line', cb)
});
