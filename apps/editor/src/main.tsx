import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-ext-400.css';
import '@fontsource/nunito/vietnamese-400.css';
import './index.css';
import App from './App.tsx';
import { initializeEditorSession } from './state/editorStartup';
import { useProjectStore } from './state/projectStore';
import { registerWebcamPreviewAdapter, stopWebcamPreview } from './state/webcamPreview';

registerWebcamPreviewAdapter();
useProjectStore.subscribe((next, previous) => {
  if (next.project.id !== previous.project.id) stopWebcamPreview();
});
initializeEditorSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
