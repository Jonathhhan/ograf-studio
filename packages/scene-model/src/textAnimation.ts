import type { TextAnimation, TextElement } from './types';

export interface TextAnimationSegment {
  text: string;
  index: number;
}

type IntlSegmenter = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' | 'word' },
) => {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

export const DEFAULT_TEXT_ANIMATION: TextAnimation = {
  type: 'none',
  split: 'grapheme',
  durationFrames: 12,
  cursor: 'bar',
  cursorBlinkFrames: 12,
  replayOnUpdate: false,
  customActionId: null,
};

export const TEXT_ANIMATION_LABELS: Record<TextAnimation['type'], string> = {
  none: 'None',
  typewriter: 'Typewriter',
  fade: 'Fade in',
  rise: 'Rise in',
  pop: 'Pop in',
  'word-reveal': 'Word reveal',
};

export function textAnimationSplit(animation: TextAnimation): TextAnimation['split'] {
  return animation.type === 'word-reveal' ? 'word' : animation.split;
}

export function normalizeTextAnimation(
  animation: Partial<TextAnimation> | null | undefined,
): TextAnimation {
  const durationFrames = Number(animation?.durationFrames);
  const cursorBlinkFrames = Number(animation?.cursorBlinkFrames);
  return {
    type:
      animation?.type && Object.hasOwn(TEXT_ANIMATION_LABELS, animation.type)
        ? animation.type
        : 'none',
    split: animation?.split === 'word' ? 'word' : 'grapheme',
    durationFrames:
      Number.isFinite(durationFrames) && durationFrames >= 1
        ? Math.max(1, Math.round(durationFrames))
        : DEFAULT_TEXT_ANIMATION.durationFrames,
    cursor:
      animation?.cursor === 'none' || animation?.cursor === 'block' ? animation.cursor : 'bar',
    cursorBlinkFrames:
      Number.isFinite(cursorBlinkFrames) && cursorBlinkFrames >= 1
        ? Math.max(1, Math.round(cursorBlinkFrames))
        : DEFAULT_TEXT_ANIMATION.cursorBlinkFrames,
    replayOnUpdate: animation?.replayOnUpdate === true,
    customActionId:
      typeof animation?.customActionId === 'string' && animation.customActionId.trim()
        ? animation.customActionId.trim()
        : null,
  };
}

export function hasTextAnimation(element: TextElement): boolean {
  return normalizeTextAnimation(element.textAnimation).type !== 'none';
}

/** Segment-local progress for an entrance that staggers across the full authored duration. */
export function textAnimationSegmentProgress(
  index: number,
  total: number,
  frame: number,
  durationFrames: number,
): number {
  const duration = Math.max(1, durationFrames);
  const entrance = total <= 1 ? duration : Math.max(1, duration * 0.4);
  const lastStart = Math.max(0, duration - entrance);
  const start = total <= 1 ? 0 : (Math.max(0, index) / (total - 1)) * lastStart;
  return Math.max(0, Math.min(1, (frame - start) / entrance));
}

export interface TextAnimationSegmentVisual {
  opacity: number;
  translateYEm: number;
  scale: number;
}

/** Pure visual sample shared by editing, realtime playout, and scheduled seeks. */
export function textAnimationSegmentVisual(
  type: TextAnimation['type'],
  progress: number,
): TextAnimationSegmentVisual {
  const t = Math.max(0, Math.min(1, progress));
  const eased = 1 - (1 - t) ** 3;
  if (type === 'rise') return { opacity: eased, translateYEm: (1 - eased) * 0.75, scale: 1 };
  if (type === 'word-reveal') return { opacity: eased, translateYEm: (1 - eased) * 1.1, scale: 1 };
  if (type === 'pop') {
    const shifted = t - 1;
    const overshoot = 1 + 2.70158 * shifted ** 3 + 1.70158 * shifted ** 2;
    return { opacity: eased, translateYEm: 0, scale: 0.7 + 0.3 * overshoot };
  }
  return { opacity: eased, translateYEm: 0, scale: 1 };
}

export function segmentTextAnimationUnits(
  text: string,
  split: TextAnimation['split'],
  language = '',
): TextAnimationSegment[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: IntlSegmenter }).Segmenter;
  let records: TextAnimationSegment[];
  if (Segmenter) {
    const segmenter = new Segmenter(language.trim() || undefined, { granularity: split });
    records = [...segmenter.segment(text)].map((entry) => ({
      text: entry.segment,
      index: entry.index,
    }));
  } else if (split === 'word') {
    records = [];
    for (const match of text.matchAll(/\s+|[^\s]+/gu)) {
      records.push({ text: match[0], index: match.index ?? 0 });
    }
  } else {
    records = [];
    let index = 0;
    for (const segment of Array.from(text)) {
      records.push({ text: segment, index });
      index += segment.length;
    }
  }

  const result: TextAnimationSegment[] = [];
  for (const record of records) {
    let index = record.index;
    for (const part of record.text.split(/(\r\n|\r|\n)/)) {
      if (!part) continue;
      result.push({ text: part, index });
      index += part.length;
    }
  }
  return result;
}

export function isAnimatedTextSegment(
  segment: TextAnimationSegment,
  split: TextAnimation['split'],
): boolean {
  if (/^(?:\r\n|\r|\n)$/.test(segment.text)) return false;
  return split !== 'word' || !/^\s+$/u.test(segment.text);
}

export function visibleTextAnimationSegmentCount(
  total: number,
  frame: number,
  durationFrames: number,
): number {
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationFrames)));
  return Math.min(total, Math.floor(progress * total + 1e-9));
}

export function textAnimationVisibleText(element: TextElement, frame: number): string {
  const animation = normalizeTextAnimation(element.textAnimation);
  if (animation.type === 'none') return element.content;
  const source = element.runs.length
    ? element.runs.map((run) => run.text).join('')
    : element.content;
  const split = textAnimationSplit(animation);
  const units = segmentTextAnimationUnits(source, split, element.language);
  const total = units.filter((unit) => isAnimatedTextSegment(unit, split)).length;
  const visible =
    animation.type === 'typewriter'
      ? visibleTextAnimationSegmentCount(total, frame, animation.durationFrames)
      : Array.from({ length: total }, (_, index) =>
          textAnimationSegmentProgress(index, total, frame, animation.durationFrames),
        ).filter((progress) => progress >= 0.5).length;
  let consumed = 0;
  let result = '';
  for (const unit of units) {
    if (isAnimatedTextSegment(unit, split)) {
      if (consumed >= visible) break;
      consumed += 1;
    }
    result += unit.text;
  }
  return result;
}
