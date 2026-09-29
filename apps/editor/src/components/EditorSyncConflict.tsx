import { resolveEditorSyncConflict, useEditorSyncConflict } from '../state/agentBridge';

export function EditorSyncConflict() {
  const active = useEditorSyncConflict((state) => state.active);
  if (!active) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 48,
        left: '15%',
        right: '15%',
        zIndex: 10000,
        padding: 16,
        background: '#332817',
        color: '#fff',
        border: '1px solid #d6a348',
        borderRadius: 8,
      }}
    >
      <strong>Concurrent changes detected</strong>
      <p>
        Your local edits are preserved. Save a copy if you need both versions before choosing which
        version to continue with.
      </p>
      <button onClick={() => resolveEditorSyncConflict('local')}>Keep local version</button>{' '}
      <button onClick={() => resolveEditorSyncConflict('remote')}>Use server version</button>
    </div>
  );
}
