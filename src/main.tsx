import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Redam error HMR / WebSocket yang tidak relevan agar UI tetap bersih
if (typeof window !== 'undefined') {
  const isBenign = (message: string) =>
    message.includes('WebSocket') ||
    message.includes('websocket') ||
    message.includes('vite') ||
    message.includes('HMR');

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason?.message || String(event.reason || '');
    if (isBenign(reason)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('error', event => {
    if (isBenign(event.message || '')) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
