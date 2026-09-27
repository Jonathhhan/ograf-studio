import type { ExpressionRect, LayerTransform, TextElement } from '@ograf-editor/scene-model';
import { disposeElementContent, renderElementContent } from './renderElement';

/** Measure with the same font, wrapping and fitting code as playout, without touching live layers. */
export function measureExpressionText(
  element: TextElement,
  transform: LayerTransform,
): ExpressionRect {
  if (typeof document === 'undefined' || !document.body)
    throw new Error('Text bounds require a browser renderer.');
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    width: `${Math.max(0, transform.width)}px`,
    height: `${Math.max(0, transform.height)}px`,
  });
  document.body.appendChild(probe);
  try {
    // Paint does not affect layout; avoid creating shader/GPU resources for measurement.
    const { strokePaint: _strokePaint, ...text } = element;
    renderElementContent(probe, { ...text, fill: '#000000', color: '#000000' });
    const content = probe.firstElementChild;
    if (!content) throw new Error('Text content could not be measured.');
    const range = document.createRange();
    range.selectNodeContents(content);
    const bounds = range.getBoundingClientRect();
    const origin = probe.getBoundingClientRect();
    return {
      left: bounds.left - origin.left,
      top: bounds.top - origin.top,
      width: bounds.width,
      height: bounds.height,
    };
  } finally {
    disposeElementContent(probe);
    probe.remove();
  }
}
