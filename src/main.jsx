import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    // Forzar recarga cuando hay una nueva versión
    updateSW(true);
  },
  onOfflineReady() {
    console.log('App ready (offline)');
  },
  immediate: true
});
