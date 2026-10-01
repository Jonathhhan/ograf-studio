import { useState, type PropsWithChildren, type ReactNode } from 'react';
import './CollapsibleSection.css';

interface CollapsibleSectionProps {
  sectionId: string;
  title: ReactNode;
  ariaLabel?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}

const STORAGE_PREFIX = 'ograf-studio:section:';

function initialOpen(sectionId: string, defaultOpen: boolean): boolean {
  if (typeof window === 'undefined') return defaultOpen;
  try {
    const saved = window.localStorage.getItem(`${STORAGE_PREFIX}${sectionId}`);
    return saved === null ? defaultOpen : saved === 'open';
  } catch {
    return defaultOpen;
  }
}

export function CollapsibleSection({
  sectionId,
  title,
  ariaLabel,
  actions,
  defaultOpen = true,
  className = '',
  contentClassName = '',
  children,
}: PropsWithChildren<CollapsibleSectionProps>) {
  const [open, setOpen] = useState(() => initialOpen(sectionId, defaultOpen));
  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${sectionId}`, next ? 'open' : 'closed');
      } catch {
        // Disclosure still works when storage is blocked by the browser.
      }
      return next;
    });
  };

  return (
    <details className={`collapsible-section${className ? ` ${className}` : ''}`} open={open}>
      <summary
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        onClick={(event) => {
          event.preventDefault();
          toggle();
        }}
      >
        <span className="collapsible-section-title">{title}</span>
        {actions ? (
          <span
            className="collapsible-section-actions"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
      </summary>
      <div
        className={`collapsible-section-content${contentClassName ? ` ${contentClassName}` : ''}`}
      >
        {children}
      </div>
    </details>
  );
}
