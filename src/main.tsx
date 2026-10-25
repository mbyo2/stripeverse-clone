import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from './App.tsx'
import './index.css'
import { installChunkRecovery } from './lib/chunkRecovery'

// After a redeploy, stale tabs reference route chunks that no
// longer exist: reload once automatically instead of stranding
// the user on an error screen (see lib/chunkRecovery.ts).
installChunkRecovery();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light">
    <App />
  </ThemeProvider>
);
