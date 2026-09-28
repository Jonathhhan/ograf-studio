import { useState } from 'react';
import {
  linkJsonFile,
  reloadLinkedJsonFile,
  unlinkJsonFile,
  useLinkedJsonFiles,
} from '../state/linkedJsonFiles';
export function LinkedJsonFile({ linkKey }: { linkKey: string }) {
  const link = useLinkedJsonFiles((s) => s.links[linkKey]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="data-field-schema-editor">
      <button
        type="button"
        disabled={busy}
        onClick={() => void action(() => linkJsonFile(linkKey))}
      >
        {link ? 'Re-link JSON file' : 'Link JSON file'}
      </button>
      {link && (
        <>
          <span> {link.name} </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(() => reloadLinkedJsonFile(linkKey))}
          >
            Reload JSON
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(() => unlinkJsonFile(linkKey))}
          >
            Unlink
          </button>
        </>
      )}
      <small>
        {' '}
        Use Reload JSON to read file changes. Save and export include the last loaded content.
      </small>
      {(error || link?.error) && (
        <p role="alert" className="inspector-error">
          {error || link?.error}
        </p>
      )}
    </div>
  );
}
