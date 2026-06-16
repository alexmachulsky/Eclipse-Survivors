// Display face (Space Grotesk) is self-hosted via @font-face in styles.css.
// DM Mono (tabular numbers / body text) stays on @fontsource.
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
