import { useEffect, useState } from 'react';
import {
  normalizeChartAnimation,
  parseChartData,
  type ChartElement,
  type EasingPreset,
} from '@ograf-editor/scene-model';
import { ChartPresetGallery } from './ChartPresetGallery';
import { EASING_OPTION_GROUPS } from './easingOptions';
import './ChartEditor.css';

function NumericCell({
  value,
  onCommit,
  min,
  max,
  label = 'Value',
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = Number(draft);
        if (draft.trim() && Number.isFinite(parsed))
          onCommit(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed)));
        else setDraft(String(value));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export function ChartEditor({
  element,
  onChange,
}: {
  element: ChartElement;
  onChange: (patch: Partial<ChartElement>) => void;
}) {
  const [dataText, setDataText] = useState(() => JSON.stringify(element.data, null, 2));
  const [error, setError] = useState('');
  const [requestedDatasetIndex, setRequestedDatasetIndex] = useState(0);
  const animation = normalizeChartAnimation(element.animation);
  const updateAnimation = (patch: Partial<NonNullable<ChartElement['animation']>>) =>
    onChange({ animation: { ...animation, ...patch } });
  const datasetIndex = Math.min(requestedDatasetIndex, element.data.datasets.length - 1);
  const dataset = element.data.datasets[datasetIndex]!;
  useEffect(() => {
    setDataText(JSON.stringify(element.data, null, 2));
    setError('');
  }, [element.data]);

  const applyData = () => {
    try {
      onChange({ data: parseChartData(dataText) });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const updateData = (data: ChartElement['data']) => onChange({ data: parseChartData(data) });
  const rowColor = (index: number) =>
    Array.isArray(dataset.backgroundColor)
      ? (dataset.backgroundColor[index] ?? '#5bc8fa')
      : dataset.backgroundColor;
  const updateRow = (index: number, patch: { label?: string; value?: number; color?: string }) => {
    const data = structuredClone(element.data);
    if (patch.label !== undefined) data.labels[index] = patch.label;
    const entry = data.datasets[datasetIndex]!;
    if (patch.value !== undefined) entry.data[index] = patch.value;
    if (patch.color !== undefined) {
      const colors = Array.isArray(entry.backgroundColor)
        ? [...entry.backgroundColor]
        : data.labels.map(() => entry.backgroundColor as string);
      colors[index] = patch.color;
      entry.backgroundColor = colors;
    }
    updateData(data);
  };
  const addRow = () => {
    const data = structuredClone(element.data);
    data.labels.push(`Item ${data.labels.length + 1}`);
    for (const entry of data.datasets) {
      entry.data.push(0);
      if (Array.isArray(entry.backgroundColor)) entry.backgroundColor.push(entry.borderColor);
    }
    updateData(data);
  };
  const removeRow = (index: number) => {
    const data = structuredClone(element.data);
    data.labels.splice(index, 1);
    for (const entry of data.datasets) {
      entry.data.splice(index, 1);
      if (Array.isArray(entry.backgroundColor)) entry.backgroundColor.splice(index, 1);
    }
    updateData(data);
  };
  const addDataset = () => {
    const data = structuredClone(element.data);
    const color = ['#5bc8fa', '#f472b6', '#34d399', '#fbbf24'][data.datasets.length % 4]!;
    data.datasets.push({
      label: `Series ${data.datasets.length + 1}`,
      data: data.labels.map(() => 0),
      backgroundColor: color,
      borderColor: color,
    });
    updateData(data);
    setRequestedDatasetIndex(data.datasets.length - 1);
  };
  const removeDataset = () => {
    const data = structuredClone(element.data);
    data.datasets.splice(datasetIndex, 1);
    updateData(data);
    setRequestedDatasetIndex(Math.max(0, datasetIndex - 1));
  };

  return (
    <div className="chart-editor">
      <div className="chart-editor-label">Chart type</div>
      <ChartPresetGallery selected={element.preset} onSelect={(preset) => onChange({ preset })} />
      <label className="chart-editor-option">
        <span>Animation</span>
        <select
          aria-label="Chart animation"
          value={animation.type}
          onChange={(event) =>
            updateAnimation({
              type: event.target.value as NonNullable<ChartElement['animation']>['type'],
            })
          }
        >
          <option value="none">None</option>
          <option value="grow">Grow</option>
          <option value="reveal">Reveal</option>
          <option value="fade">Fade</option>
        </select>
      </label>
      {animation.type !== 'none' && (
        <>
          <div
            className={`chart-animation-timing${animation.type === 'grow' ? ' has-stagger' : ''}`}
          >
            <label>
              <span>Duration (frames)</span>
              <NumericCell
                value={animation.durationFrames}
                min={1}
                max={1500}
                label="Chart animation duration in frames"
                onCommit={(durationFrames) =>
                  updateAnimation({ durationFrames: Math.round(durationFrames) })
                }
              />
            </label>
            <label>
              <span>Delay (frames)</span>
              <NumericCell
                value={animation.delayFrames}
                min={0}
                max={1500}
                label="Chart animation delay in frames"
                onCommit={(delayFrames) =>
                  updateAnimation({ delayFrames: Math.round(delayFrames) })
                }
              />
            </label>
            {animation.type === 'grow' && (
              <label title="Frames between consecutive chart items">
                <span>Stagger (frames)</span>
                <NumericCell
                  value={animation.staggerFrames}
                  min={0}
                  max={100}
                  label="Chart animation stagger in frames"
                  onCommit={(staggerFrames) =>
                    updateAnimation({ staggerFrames: Math.round(staggerFrames) })
                  }
                />
              </label>
            )}
          </div>
          <label className="chart-editor-option">
            <span>Easing</span>
            <select
              aria-label="Chart animation easing"
              value={animation.easing}
              onChange={(event) => updateAnimation({ easing: event.target.value as EasingPreset })}
            >
              {EASING_OPTION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="chart-editor-option">
            <span>Replay on data update</span>
            <input
              type="checkbox"
              checked={animation.replayOnUpdate}
              onChange={(event) => updateAnimation({ replayOnUpdate: event.target.checked })}
            />
          </label>
        </>
      )}
      <label className="chart-editor-option">
        <span>Text color</span>
        <input
          type="color"
          value={element.textColor}
          onChange={(event) => onChange({ textColor: event.target.value })}
        />
      </label>
      <label className="chart-editor-option">
        <span>Label size</span>
        <NumericCell
          value={element.fontSize}
          min={8}
          max={96}
          label="Label size"
          onCommit={(fontSize) => onChange({ fontSize })}
        />
      </label>
      <label className="chart-editor-option">
        <span>Legend</span>
        <input
          type="checkbox"
          checked={element.showLegend}
          onChange={(event) => onChange({ showLegend: event.target.checked })}
        />
      </label>
      <label className="chart-editor-option">
        <span>Grid</span>
        <input
          type="checkbox"
          checked={element.showGrid}
          onChange={(event) => onChange({ showGrid: event.target.checked })}
        />
      </label>
      <div className="chart-editor-label">Data series</div>
      <div className="chart-dataset-controls">
        <select
          aria-label="Data series"
          value={datasetIndex}
          onChange={(event) => setRequestedDatasetIndex(Number(event.target.value))}
        >
          {element.data.datasets.map((item, index) => (
            <option key={index} value={index}>
              {item.label || `Series ${index + 1}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Add series"
          aria-label="Add data series"
          disabled={element.data.datasets.length >= 12}
          onClick={addDataset}
        >
          +
        </button>
        <button
          type="button"
          title="Remove series"
          aria-label="Remove data series"
          disabled={element.data.datasets.length <= 1}
          onClick={removeDataset}
        >
          −
        </button>
      </div>
      <input
        aria-label="Series name"
        value={dataset.label}
        onChange={(event) => {
          const data = structuredClone(element.data);
          data.datasets[datasetIndex]!.label = event.target.value;
          updateData(data);
        }}
      />
      <div className="chart-rows" role="group" aria-label="Chart rows">
        {element.data.labels.map((label, index) => (
          <div className="chart-row" key={index}>
            <input
              aria-label={`Label ${index + 1}`}
              value={label}
              onChange={(event) => updateRow(index, { label: event.target.value })}
            />
            <NumericCell
              value={dataset.data[index]!}
              label={`Value for ${label}`}
              onCommit={(value) => updateRow(index, { value })}
            />
            <input
              type="color"
              aria-label={`Color ${index + 1}`}
              value={rowColor(index)}
              onChange={(event) => updateRow(index, { color: event.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove row ${index + 1}`}
              disabled={element.data.labels.length <= 1}
              onClick={() => removeRow(index)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" disabled={element.data.labels.length >= 100} onClick={addRow}>
        + Add row
      </button>
      <details className="chart-editor-advanced">
        <summary>Advanced · edit JSON</summary>
        <label className="chart-editor-label" htmlFor="chart-data-json">
          Chart data (labels and datasets)
        </label>
        <textarea
          id="chart-data-json"
          value={dataText}
          onChange={(event) => setDataText(event.target.value)}
          onBlur={applyData}
          spellCheck={false}
          rows={11}
        />
        {error && (
          <p className="chart-editor-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={applyData}>
          Apply data
        </button>
      </details>
    </div>
  );
}
