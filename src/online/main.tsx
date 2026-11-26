import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OnlineApp } from './OnlineApp';
import '@fontsource/russo-one';
import '../styles.css';
import './online.css';

const { protocol, hostname, href } = window.location;

// The secret guest token must never travel unencrypted.
if (import.meta.env.PROD && protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
  window.location.replace(href.replace(/^http:/, 'https:'));
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <OnlineApp />
    </StrictMode>,
  );
}
