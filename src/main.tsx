import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/m-plus-1p';
import '@fontsource/league-mono';
import './index.css'
import App from './App.tsx'
import { InstrumentProvider } from './components/InstrumentContext.tsx'
import { PlaylistProvider } from './components/Playlist.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstrumentProvider>
      <PlaylistProvider>
        <App />
      </PlaylistProvider>
    </InstrumentProvider>
  </StrictMode>,
)
