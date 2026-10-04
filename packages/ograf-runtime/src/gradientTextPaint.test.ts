import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultGradient,
  createEllipseElement,
  createRectangleElement,
  createTextElement,
  getPaintAtFrame,
  paintToCss,
  type LayerAnimationTracks,
} from '@ograf-editor/scene-model';
import { applyAnimatedPaint, renderElementContent } from './renderElement';

/** Model the CSS shorthand reset that plain style-object renderer mocks cannot reproduce. */
function cssStyle(): CSSStyleDeclaration {
  let background = '';
  let backgroundImage = '';
  const style = {
    backgroundClip: 'border-box',
    webkitBackgroundClip: 'border-box',
    get background() {
      return backgroundImage || background;
    },
    set background(value: string) {
      background = value;
      backgroundImage = value.includes('gradient(') ? value : '';
      style.backgroundClip = 'border-box';
      style.webkitBackgroundClip = 'border-box';
    },
    get backgroundImage() {
      return backgroundImage;
    },
    set backgroundImage(value: string) {
      backgroundImage = value;
    },
  };
  return style as unknown as CSSStyleDeclaration;
}

class FakeElement {
  style = cssStyle();
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  className = '';
  textContent = '';
  classList = { contains: (name: string) => this.className.split(/\s+/).includes(name) };

  constructor(
    readonly tagName: string,
    readonly ownerDocument: { createElement: (tag: string) => FakeElement },
  ) {}

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  append(...children: Array<FakeElement | string>) {
    for (const child of children) {
      if (typeof child === 'string') this.textContent += child;
      else this.appendChild(child);
    }
  }

  replaceChildren() {
    this.children = [];
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    const key = name.startsWith('data-')
      ? name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      : null;
    return (key ? this.dataset[key] : this.attributes[name]) ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    const matches = (child: FakeElement) =>
      attribute
        ? child.getAttribute(attribute[1]!) !== null &&
          (attribute[2] === undefined || child.getAttribute(attribute[1]!) === attribute[2])
        : child.tagName.toLowerCase() === selector.toLowerCase();
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const document = {
  createElement: (tag: string): FakeElement => new FakeElement(tag.toUpperCase(), document),
};
const dom = (element: FakeElement) => element as unknown as HTMLElement;

const stopTracks: LayerAnimationTracks = {
  'fill.stops[0].offset': [
    { id: 'start', frame: 0, value: 0, easing: 'linear' },
    { id: 'end', frame: 10, value: 0.5, easing: 'linear' },
  ],
};

describe('gradient glyph clipping across paint sampling', () => {
  beforeEach(() => vi.stubGlobal('document', document));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps styled run sizes inherited from the template instead of editor UI span styles', () => {
    const host = document.createElement('div');
    renderElementContent(
      dom(host),
      createTextElement({
        content: 'Styled',
        runs: [{ text: 'Styled', fontStyle: 'italic', fontWeight: 800 }],
        fontSize: 76,
        autoFit: 'fixed',
      }),
    );
    expect(host.firstElementChild!.style.fontSize).toBe('76px');
    expect(host.firstElementChild!.firstElementChild!.style).toMatchObject({
      fontSize: 'inherit',
      fontStyle: 'italic',
      fontWeight: '800',
    });
  });

  it.each(['linear', 'radial', 'conic'] as const)(
    'retains %s text glyph clipping even without animation tracks',
    (type) => {
      const host = document.createElement('div');
      const fill = createDefaultGradient(type);
      renderElementContent(dom(host), createTextElement({ fill, autoFit: 'fixed' }));
      const glyphs = host.firstElementChild!;
      expect(glyphs.style.backgroundClip).toBe('text');

      applyAnimatedPaint(dom(host), {}, 0);

      expect(glyphs.style.backgroundClip).toBe('text');
      expect(glyphs.style.webkitBackgroundClip).toBe('text');
      expect(glyphs.style.backgroundImage).toBe(paintToCss(fill));
      expect(glyphs.style.color).toBe('transparent');
    },
  );

  it('retains clipping through animated stops, reverse seeking and editor content-host wrapping', () => {
    const layer = document.createElement('div');
    const host = document.createElement('div');
    host.className = 'layer-content-host';
    layer.appendChild(host);
    const fill = createDefaultGradient();
    renderElementContent(dom(host), createTextElement({ fill, autoFit: 'fixed' }));
    const glyphs = host.firstElementChild!;

    for (const frame of [0, 5, 10, 2, 5]) {
      applyAnimatedPaint(dom(layer), stopTracks, frame);
      expect(glyphs.style.backgroundImage).toBe(
        paintToCss(getPaintAtFrame(fill, stopTracks, frame)),
      );
      expect(glyphs.style.backgroundClip).toBe('text');
      expect(glyphs.style.webkitBackgroundClip).toBe('text');
    }
  });

  it('keeps the whole text-animation flow clipped while its reveal spans remain mounted', () => {
    const host = document.createElement('div');
    const element = createTextElement({
      fill: createDefaultGradient(),
      content: 'GOAL',
      autoFit: 'fixed',
    });
    element.textAnimation = { ...element.textAnimation, type: 'typewriter', cursor: 'none' };
    renderElementContent(dom(host), element);
    const flow = host.querySelector('[data-ograf-text-flow="true"]')!;
    expect(flow.querySelectorAll('[data-ograf-text-segment]')).toHaveLength(4);

    applyAnimatedPaint(dom(host), stopTracks, 5);

    expect(host.querySelector('[data-ograf-text-flow="true"]')).toBe(flow);
    expect(host.firstElementChild!.style.backgroundClip).toBe('text');
    expect(host.firstElementChild!.style.webkitBackgroundClip).toBe('text');
    expect(flow.style.backgroundClip).toBe('border-box');
  });

  it.each([
    ['rectangle', createRectangleElement],
    ['ellipse', createEllipseElement],
  ] as const)(
    'continues painting %s gradient and solid fills across their boxes',
    (_kind, create) => {
      const host = document.createElement('div');
      const fill = createDefaultGradient();
      renderElementContent(dom(host), create({ fill }));
      applyAnimatedPaint(dom(host), stopTracks, 5);
      expect(host.firstElementChild!.style.backgroundImage).toBe(
        paintToCss(getPaintAtFrame(fill, stopTracks, 5)),
      );
      expect(host.firstElementChild!.style.backgroundClip).toBe('border-box');
      expect(host.firstElementChild!.style.webkitBackgroundClip).toBe('border-box');

      renderElementContent(dom(host), create({ fill: '#ff3366' }));
      applyAnimatedPaint(dom(host), {}, 5);
      expect(host.firstElementChild!.style.background).toBe('#ff3366');
      expect(host.firstElementChild!.style.backgroundClip).toBe('border-box');
    },
  );

  it('updates only the dedicated path-fill surface without changing its box clipping', () => {
    const host = document.createElement('div');
    const path = document.createElement('div');
    const fillSurface = document.createElement('div');
    fillSurface.dataset.ografPathFill = 'true';
    path.appendChild(fillSurface);
    host.appendChild(path);
    const fill = createDefaultGradient();
    host.dataset.ografBasePaint = JSON.stringify(fill);

    applyAnimatedPaint(dom(host), stopTracks, 5);

    expect(fillSurface.style.backgroundImage).toBe(
      paintToCss(getPaintAtFrame(fill, stopTracks, 5)),
    );
    expect(fillSurface.style.backgroundClip).toBe('border-box');
    expect(path.style.background).toBe('');
  });
});
