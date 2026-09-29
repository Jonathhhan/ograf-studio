import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createProject } from '@ograf-editor/scene-model';
import { saveProjectToFile } from './fileIO';
import { certifyProject } from './ografCompatibility';
import { createTemplateThumbnail } from './templateThumbnail';

vi.mock('./ografCompatibility', () => ({ certifyProject: vi.fn() }));
vi.mock('./templateThumbnail', () => ({ createTemplateThumbnail: vi.fn() }));

describe('saving a template with its thumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(certifyProject).mockResolvedValue({ valid: true, errors: [], checks: [] } as never);
    vi.mocked(createTemplateThumbnail).mockResolvedValue(
      new Blob(['png-bytes'], { type: 'image/png' }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('commits the source first and includes an optional thumbnail without certification', async () => {
    const saved = new Map<string, Blob>();
    const events: string[] = [];
    const directory = {
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        let content: Blob;
        return {
          createWritable: async () => ({
            write: async (data: Blob) => {
              content = data;
              events.push('write');
            },
            close: async () => {
              saved.set(name, content);
              events.push('close');
            },
            abort: vi.fn(),
          }),
        };
      }),
    };
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => {
        events.push('picker');
        return directory;
      },
      confirm: () => true,
    });
    vi.mocked(createTemplateThumbnail).mockImplementation(async () => {
      events.push('thumbnail');
      return new Blob(['png-bytes'], { type: 'image/png' });
    });
    const project = createProject({ name: 'News', thumbnailFrame: 7 });
    expect(
      await saveProjectToFile(project, {
        baseName: 'My Template',
        thumbnail: new Blob(['png-bytes'], { type: 'image/png' }),
      }),
    ).toBe('saved');
    expect([...saved.keys()]).toEqual(['My Template.ogs', `${project.id}_thumb.png`]);
    expect(JSON.parse(await saved.get('My Template.ogs')!.text())).toMatchObject({
      name: 'My Template',
      thumbnailFrame: 7,
    });
    expect(certifyProject).not.toHaveBeenCalled();
    expect(createTemplateThumbnail).not.toHaveBeenCalled();
    expect(project.name).toBe('News');
    expect(saved.get(`${project.id}_thumb.png`)!.type).toBe('image/png');
    expect(events).toEqual(['picker', 'write', 'close', 'write', 'close']);
  });

  it('saves incomplete source without invoking a failing renderer or compatibility gate', async () => {
    const write = vi.fn();
    const directory = {
      getFileHandle: vi.fn(async (_name, options) => {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        return { createWritable: async () => ({ write, close: vi.fn(), abort: vi.fn() }) };
      }),
    };
    vi.stubGlobal('window', { showDirectoryPicker: async () => directory });
    vi.mocked(certifyProject).mockResolvedValue({
      valid: false,
      errors: ['Invalid graphic'],
      checks: [],
    } as never);
    vi.mocked(createTemplateThumbnail).mockRejectedValue(new Error('Renderer failed'));
    const project = createProject();
    project.compositions[0]!.scripting = { enabled: true, source: 'broken(', modules: [] };
    await expect(saveProjectToFile(project)).resolves.toBe('saved');
    expect(
      JSON.parse(await (write.mock.calls[0]![0] as Blob).text()).compositions[0].scripting.source,
    ).toBe('broken(');
    expect(certifyProject).not.toHaveBeenCalled();
    expect(createTemplateThumbnail).not.toHaveBeenCalled();
  });

  it('downloads one ZIP containing both files when folder access is unavailable', async () => {
    let output: Blob | undefined;
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
    });
    vi.stubGlobal('document', { createElement: () => anchor });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      output = blob as Blob;
      return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const project = createProject({ name: 'Lower Third' });
    expect(
      await saveProjectToFile(project, {
        baseName: 'Evening News.ogs',
        thumbnail: new Blob(['png-bytes']),
      }),
    ).toBe('downloaded');
    expect(anchor.download).toBe('Evening News.source.zip');
    const zip = await JSZip.loadAsync(await output!.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['Evening News.ogs', `${project.id}_thumb.png`]);
    expect(await zip.file(`${project.id}_thumb.png`)!.async('string')).toBe('png-bytes');
    expect(JSON.parse(await zip.file('Evening News.ogs')!.async('string')).name).toBe(
      'Evening News',
    );
    expect(project.name).toBe('Lower Third');
  });

  it('keeps a successful source save when writing the optional PNG fails', async () => {
    const written: string[] = [];
    vi.stubGlobal('window', {
      showDirectoryPicker: async () => ({
        getFileHandle: async (name: string, options?: { create?: boolean }) => {
          if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
          if (name.endsWith('.png')) throw new Error('PNG access denied');
          return {
            createWritable: async () => ({
              write: async () => {},
              close: async () => {
                written.push(name);
              },
              abort: async () => {},
            }),
          };
        },
      }),
    });
    await expect(
      saveProjectToFile(createProject({ name: 'Draft' }), { thumbnail: new Blob(['png']) }),
    ).resolves.toBe('saved');
    expect(written).toEqual(['Draft.ogs']);
  });
});
