import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEffect, createLayerOfKind } from '@ograf-editor/scene-model';

const mocks = vi.hoisted(() => ({
  toCanvas: vi.fn(),
  createRenderer: vi.fn(),
}));
vi.mock('html-to-image', () => ({ toCanvas: mocks.toCanvas }));
vi.mock('./shaderRendering', () => ({ createShaderRenderer: mocks.createRenderer }));

import { applyLayerEffectsFilter, waitForLayerEffectsReady } from './effectCompositing';

class Node {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: Node[] = [];
  parentNode: Node | null = null;
  clientWidth = 100;
  clientHeight = 60;
  currentSrc = '';
  src = '';
  ownerDocument!: { createElement: (tag: string) => Node; createElementNS: () => Node };
  setAttribute() {}
  appendChild(node: Node) {
    node.remove();
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  remove() {
    if (this.parentNode)
      this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }
  querySelectorAll(selector: string): Node[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector === 'img') return descendants.filter((node) => node.dataset.kind === 'img');
    if (selector === 'canvas') return descendants.filter((node) => node.dataset.kind === 'canvas');
    return [];
  }
}

class Canvas extends Node {
  width = 0;
  height = 0;
  context = {
    filter: 'none',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  };
  constructor() {
    super();
    this.dataset.kind = 'canvas';
  }
  getContext() {
    return this.context;
  }
}

function fixture() {
  const document = {
    createElement: (tag: string) => {
      const node = tag === 'canvas' ? new Canvas() : new Node();
      node.ownerDocument = document;
      return node;
    },
    createElementNS: () => {
      const node = new Node();
      node.ownerDocument = document;
      return node;
    },
  };
  const host = new Node();
  host.ownerDocument = document;
  host.style.width = '100px';
  host.style.height = '60px';
  const content = new Node();
  content.ownerDocument = document;
  host.appendChild(content);
  const base = document.createElement('canvas') as Canvas;
  base.width = 100;
  base.height = 60;
  mocks.toCanvas.mockResolvedValue(base);
  return { host, content, base };
}

beforeEach(() => {
  vi.stubGlobal('HTMLElement', Node);
  mocks.toCanvas.mockReset();
  mocks.createRenderer.mockReset();
  mocks.createRenderer.mockImplementation(() => ({
    setInput: vi.fn(),
    setEffectBlend: vi.fn(),
    updateParameters: vi.fn(),
    render: vi.fn(),
    ready: vi.fn(async () => {}),
    dispose: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('shader effect compositing', () => {
  it('captures the incoming stack result and supplies it to iChannel0 in order', async () => {
    const { host, content, base } = fixture();
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'brightness', { enabled: true, params: { amount: 1.2 } });
    addEffect(layer, 'shader', { blendMode: 'screen', blendOpacity: 0.6 });

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 1250);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);

    expect(mocks.toCanvas).toHaveBeenCalledOnce();
    expect(mocks.createRenderer).toHaveBeenCalledOnce();
    const renderer = mocks.createRenderer.mock.results[0]!.value;
    expect(renderer.setInput).toHaveBeenCalledOnce();
    expect(renderer.setInput.mock.calls[0]![0]).not.toBe(base);
    expect(renderer.render).toHaveBeenCalledWith(1250);
    expect(content.style.opacity).toBe('0');
    expect(host.children.some((node) => node.dataset.ografShaderEffectOutput === 'true')).toBe(
      true,
    );
  });

  it('commits a completed Media frame while a newer effect frame is queued', async () => {
    const { host } = fixture();
    const media = host.ownerDocument.createElement('canvas') as Canvas;
    media.width = 100;
    media.height = 60;
    media.dataset.ografMediaCanvas = 'true';
    host.appendChild(media);
    const layer = createLayerOfKind('rectangle');
    layer.effects.stack = [];
    addEffect(layer, 'shader', { blendMode: 'normal' });
    let resolveFirst = (_canvas: Canvas) => {};
    let resolveSecond = (_canvas: Canvas) => {};
    mocks.toCanvas
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 0);
    applyLayerEffectsFilter(host as unknown as HTMLElement, layer.effects, 16);
    const first = host.ownerDocument.createElement('canvas') as Canvas;
    first.width = 100;
    first.height = 60;
    resolveFirst(first);

    await vi.waitFor(() => expect(mocks.toCanvas).toHaveBeenCalledTimes(2));
    const output = host.children.find(
      (node) => node.dataset.ografShaderEffectOutput === 'true',
    ) as Canvas;
    expect(output.context.drawImage).toHaveBeenCalledOnce();

    const second = host.ownerDocument.createElement('canvas') as Canvas;
    second.width = 100;
    second.height = 60;
    resolveSecond(second);
    await waitForLayerEffectsReady(host as unknown as HTMLElement);
    expect(output.context.drawImage).toHaveBeenCalledTimes(2);
  });
});
