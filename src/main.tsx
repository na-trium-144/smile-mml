import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/m-plus-1p';
import './index.css'
import App from './App.tsx'
import { InstrumentProvider } from './components/InstrumentContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InstrumentProvider>
      <App />
    </InstrumentProvider>
  </StrictMode>,
)
