import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAsset,
  createLayerOfKind,
  createMediaPaint,
  createProject,
  getElementMediaPaint,
} from '@ograf-editor/scene-model';

import {
  MAX_REMOTE_PROJECT_BYTES,
  openProjectFromUrl,
  openProjectFromFile,
  parseProjectSource,
  type ProjectFetcher,
} from './fileIO';

describe('remote OGraf Studio project loading', () => {
  it('preserves packaged Media paint through an editable source save and reopen round trip', () => {
    const project = createProject({ name: 'Media source round trip' });
    const composition = project.compositions[0]!;
    const asset = createAsset({
      id: 'clip',
      name: 'Opening clip',
      kind: 'media',
      mimeType: 'video/mp4',
      dataUri: 'data:video/mp4;base64,AAAA',
      byteSize: 3,
      originalFileName: 'opening.mp4',
    });
    const layer = createLayerOfKind('rectangle');
    if (!('fill' in layer.element)) throw new Error('Expected a fill-capable layer.');
    layer.element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'asset:clip' },
      fit: 'contain',
      positionX: 0.25,
      positionY: 0.75,
      loop: false,
      speed: 1.5,
      offsetMs: 420,
    });
    composition.assets.push(asset);
    composition.layers.push(layer);

    const reopened = parseProjectSource(JSON.stringify(project));
    const reopenedComposition = reopened.compositions[0]!;
    expect(reopenedComposition.assets[0]).toMatchObject({
      id: 'clip',
      kind: 'media',
      dataUri: 'data:video/mp4;base64,AAAA',
      originalFileName: 'opening.mp4',
    });
    expect(getElementMediaPaint(reopenedComposition.layers.at(-1)!.element)).toEqual(
      getElementMediaPaint(layer.element),
    );
  });

  it('downloads a valid HTTP project without credentials', async () => {
    const project = createProject();
    project.name = 'Remote News';
    const fetchProject = vi.fn<ProjectFetcher>(async () =>
      Promise.resolve(
        new Response(JSON.stringify(project), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      openProjectFromUrl('https://graphics.example/news.ogs', fetchProject),
    ).resolves.toMatchObject({ id: project.id, name: 'Remote News' });
    expect(fetchProject).toHaveBeenCalledWith(
      new URL('https://graphics.example/news.ogs'),
      expect.objectContaining({
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
      }),
    );
  });

  it('rejects non-web schemes before fetching', async () => {
    const fetchProject = vi.fn<ProjectFetcher>();

    await expect(openProjectFromUrl('file:///C:/graphics/news.ogs', fetchProject)).rejects.toThrow(
      'HTTP or HTTPS',
    );
    expect(fetchProject).not.toHaveBeenCalled();
  });

  it('reports HTTP, CORS/network, and malformed-project failures', async () => {
    await expect(
      openProjectFromUrl(
        'https://graphics.example/missing.ogs',
        async () => new Response('', { status: 404 }),
      ),
    ).rejects.toThrow('HTTP 404');
    await expect(
      openProjectFromUrl('https://graphics.example/cors.ogs', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow('server CORS policy');
    expect(() => parseProjectSource('{broken')).toThrow('not valid JSON');
    expect(() => parseProjectSource(JSON.stringify({ name: 'Not a project' }))).toThrow(
      'not a valid OGraf Studio project',
    );
  });

  it('rejects declared and streamed payloads above the remote size limit', async () => {
    await expect(
      openProjectFromUrl(
        'https://graphics.example/huge.ogs',
        async () =>
          new Response('{}', {
            headers: { 'content-length': String(MAX_REMOTE_PROJECT_BYTES + 1) },
          }),
      ),
    ).rejects.toThrow('32 MiB');

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REMOTE_PROJECT_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expect(
      openProjectFromUrl(
        'https://graphics.example/streamed.ogs',
        async () => new Response(oversizedStream),
      ),
    ).rejects.toThrow('32 MiB');
  });
});

describe('opening local project names', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['Evening News.ogs', 'Evening News.OGS', 'Evening News.ogeproj', 'Evening News.json'])(
    'uses the selected filename %s instead of stale metadata',
    async (name) => {
      const source = JSON.stringify(createProject({ name: 'Untitled Template' }));
      vi.stubGlobal('window', {
        showOpenFilePicker: async () => [
          { getFile: async () => ({ name, text: async () => source }) },
        ],
      });
      expect((await openProjectFromFile())?.name).toBe('Evening News');
      expect(parseProjectSource(source).name).toBe('Untitled Template');
    },
  );
  it('also uses the filename through the fallback input picker', async () => {
    const input = {
      type: '',
      accept: '',
      files: [
        {
          name: 'News.v2.ogs',
          text: async () => JSON.stringify(createProject({ name: 'Old title' })),
        },
      ],
      onchange: undefined as (() => void) | undefined,
      click() {
        this.onchange?.();
      },
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement: () => input });
    expect((await openProjectFromFile())?.name).toBe('News.v2');
  });
});
