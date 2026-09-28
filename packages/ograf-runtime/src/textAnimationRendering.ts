import {
  isAnimatedTextSegment,
  normalizeTextAnimation,
  segmentTextAnimationUnits,
  textAnimationSegmentProgress,
  textAnimationSegmentVisual,
  textAnimationSplit,
  visibleTextAnimationSegmentCount,
  type TextElement,
  type TextRun,
} from '@ograf-editor/scene-model';

interface StyledRange {
  start: number;
  end: number;
  run: TextRun;
}

function textSource(element: TextElement): string {
  return element.runs.length ? element.runs.map((run) => run.text).join('') : element.content;
}

function styledRanges(runs: TextRun[]): StyledRange[] {
  let offset = 0;
  return runs.map((run) => {
    const range = { start: offset, end: offset + run.text.length, run };
    offset = range.end;
    return range;
  });
}

function applyRunStyle(element: HTMLElement, run: TextRun): void {
  if (run.color) element.style.color = run.color;
  if (run.fontWeight !== undefined) element.style.fontWeight = String(run.fontWeight);
  if (run.fontStyle) element.style.fontStyle = run.fontStyle;
  if (run.fontFamily) element.style.fontFamily = run.fontFamily;
}

function appendStyledText(
  target: HTMLElement,
  text: string,
  sourceIndex: number,
  ranges: StyledRange[],
): void {
  if (ranges.length === 0) {
    target.textContent = text;
    return;
  }
  const end = sourceIndex + text.length;
  let cursor = sourceIndex;
  while (cursor < end) {
    const range = ranges.find((candidate) => cursor >= candidate.start && cursor < candidate.end);
    if (!range) {
      target.append(text.slice(cursor - sourceIndex));
      break;
    }
    const sliceEnd = Math.min(end, range.end);
    const span = target.ownerDocument.createElement('span');
    span.textContent = text.slice(cursor - sourceIndex, sliceEnd - sourceIndex);
    applyRunStyle(span, range.run);
    target.appendChild(span);
    cursor = sliceEnd;
  }
}

/** Build one stable inline-flow subtree; revealing segments never changes its measured layout. */
export function mountTextAnimationContent(content: HTMLElement, element: TextElement): void {
  const animation = normalizeTextAnimation(element.textAnimation);
  const source = textSource(element);
  const flow = content.ownerDocument.createElement('span');
  flow.dataset.ografTextFlow = 'true';
  flow.style.display = 'block';
  flow.style.width = '100%';
  flow.setAttribute('aria-hidden', 'true');
  content.setAttribute('aria-label', source);

  const ranges = styledRanges(element.runs);
  let animationIndex = 0;
  const split = textAnimationSplit(animation);
  for (const record of segmentTextAnimationUnits(source, split, element.language)) {
    if (!isAnimatedTextSegment(record, split)) {
      flow.append(record.text);
      continue;
    }
    const segment = content.ownerDocument.createElement('span');
    segment.dataset.ografTextSegment = String(animationIndex);
    segment.style.display = 'inline-block';
    segment.style.visibility = animation.type === 'typewriter' ? 'hidden' : 'visible';
    segment.style.opacity = animation.type === 'typewriter' ? '1' : '0';
    if (animation.type === 'word-reveal') {
      segment.style.overflow = 'hidden';
      segment.style.verticalAlign = 'bottom';
      const inner = content.ownerDocument.createElement('span');
      inner.dataset.ografTextSegmentInner = 'true';
      inner.style.display = 'inline-block';
      appendStyledText(inner, record.text, record.index, ranges);
      segment.appendChild(inner);
    } else appendStyledText(segment, record.text, record.index, ranges);
    flow.appendChild(segment);
    animationIndex += 1;
  }

  if (animation.type === 'typewriter' && animation.cursor !== 'none') {
    const cursor = content.ownerDocument.createElement('span');
    cursor.dataset.ografTextCursor = animation.cursor;
    cursor.setAttribute('aria-hidden', 'true');
    Object.assign(cursor.style, {
      display: 'inline-block',
      width: animation.cursor === 'block' ? '0.55em' : '0.08em',
      minWidth: animation.cursor === 'block' ? '0.55em' : '2px',
      height: '0.9em',
      marginLeft: '0.08em',
      verticalAlign: '-0.08em',
      background: element.color === 'transparent' ? '#ffffff' : element.color,
      opacity: '1',
    });
    flow.insertBefore(cursor, flow.firstChild);
  }
  content.appendChild(flow);
}

export function textAnimationSegmentCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-ograf-text-segment]').length;
}

/** Apply a deterministic text entrance snapshot at an OGraf-local frame. */
export function renderTextAnimationAtFrame(
  container: HTMLElement,
  element: TextElement,
  frame: number,
): void {
  const animation = normalizeTextAnimation(element.textAnimation);
  if (animation.type === 'none') return;
  const flow = container.querySelector<HTMLElement>('[data-ograf-text-flow="true"]');
  if (!flow) return;
  const segments = [...flow.querySelectorAll<HTMLElement>('[data-ograf-text-segment]')];
  if (animation.type !== 'typewriter') {
    segments.forEach((segment, index) => {
      const progress = textAnimationSegmentProgress(
        index,
        segments.length,
        frame,
        animation.durationFrames,
      );
      const visual = textAnimationSegmentVisual(animation.type, progress);
      segment.style.opacity = String(visual.opacity);
      if (animation.type === 'rise') {
        segment.style.transform = `translateY(${visual.translateYEm}em)`;
      } else if (animation.type === 'pop') {
        segment.style.transform = `scale(${visual.scale})`;
      } else if (animation.type === 'word-reveal') {
        const inner = segment.querySelector<HTMLElement>('[data-ograf-text-segment-inner]');
        if (inner) inner.style.transform = `translateY(${visual.translateYEm}em)`;
      }
    });
    return;
  }
  const visibleCount = visibleTextAnimationSegmentCount(
    segments.length,
    frame,
    animation.durationFrames,
  );
  for (let index = 0; index < segments.length; index += 1) {
    segments[index]!.style.visibility = index < visibleCount ? 'visible' : 'hidden';
  }

  const cursor = flow.querySelector<HTMLElement>('[data-ograf-text-cursor]');
  if (!cursor) return;
  const nextSegment = segments[visibleCount] ?? null;
  flow.insertBefore(cursor, nextSegment);
  const complete = visibleCount >= segments.length;
  const blinkOn = Math.floor(Math.max(0, frame) / animation.cursorBlinkFrames) % 2 === 0;
  cursor.style.display = complete ? 'none' : 'inline-block';
  cursor.style.opacity = blinkOn ? '1' : '0';
}
