import { useEffect, useState, type ChangeEvent } from 'react';
import {
  isGradientPaint,
  type FieldDefinition,
  type GradientPaint,
} from '@ograf-editor/scene-model';
import type { TestValue } from '../state/testDataStore';
import { PaintEditor } from './PaintEditor';
import './DataFieldInput.css';

export function DataFieldInput({
  field,
  value,
  onChange,
  interactive = false,
}: {
  interactive?: boolean;
  field: FieldDefinition;
  value: TestValue;
  onChange: (value: TestValue) => void;
}) {
  const { type } = field;
  const label = field.label || field.key;
  if (type === 'boolean') {
    const input = (
      <input
        type="checkbox"
        role={interactive ? 'switch' : undefined}
        aria-label={label}
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
    return interactive ? (
      <label className="data-field-toggle">
        {input}
        <span>{value ? 'On' : 'Off'}</span>
      </label>
    ) : (
      input
    );
  }
  if (type === 'number' || type === 'integer' || type === 'duration-ms' || type === 'percentage') {
    return (
      <NumericValueInput
        key={field.id + ':' + type}
        field={field}
        value={value}
        onChange={onChange}
        interactive={interactive}
      />
    );
  }
  if (type === 'color') {
    return (
      <input
        type="color"
        aria-label={label}
        value={String(value)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    );
  }
  if (type === 'textarea') {
    return (
      <textarea
        aria-label={label}
        rows={2}
        value={String(value)}
        minLength={field.constraints.minLength}
        maxLength={field.constraints.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (type === 'gradient') {
    return value && typeof value === 'object' && !Array.isArray(value) && 'stops' in value ? (
      <PaintEditor
        allowShader={false}
        allowMedia={false}
        value={value as GradientPaint}
        onChange={(paint) => {
          if (paint !== undefined && isGradientPaint(paint)) onChange(paint);
        }}
      />
    ) : null;
  }
  if (type === 'select') {
    return (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (type === 'select-multiple') {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
    return (
      <select
        aria-label={label}
        multiple
        value={selected}
        onChange={(event) =>
          onChange([...event.target.selectedOptions].map((option) => option.value))
        }
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (type === 'object' || type === 'array') {
    return <JsonValueInput label={label} value={value} onChange={onChange} />;
  }
  return (
    <input
      type="text"
      aria-label={label}
      placeholder={type === 'image-url' ? 'asset:… or image path' : undefined}
      minLength={field.constraints.minLength}
      maxLength={field.constraints.maxLength}
      pattern={field.constraints.pattern}
      value={String(value)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

function NumericValueInput({
  field,
  value,
  onChange,
  interactive,
}: {
  field: FieldDefinition;
  value: TestValue;
  onChange: (value: TestValue) => void;
  interactive: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const { minimum, maximum, step } = field.constraints;
  const label = field.label || field.key;
  const numericStep = step ?? (field.type === 'number' || field.type === 'percentage' ? 'any' : 1);
  const input = (
    <input
      type="number"
      aria-label={`${label} value`}
      min={minimum}
      max={maximum}
      step={numericStep}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        // Empty/incomplete input belongs to editing state, never persisted numeric data.
        if (next.trim() && Number.isFinite(event.target.valueAsNumber))
          onChange(event.target.valueAsNumber);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
  return interactive && minimum !== undefined && maximum !== undefined ? (
    <div className="data-field-range">
      <input
        type="range"
        aria-label={`${label} slider`}
        min={minimum}
        max={maximum}
        step={numericStep}
        value={Number(value)}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.valueAsNumber);
        }}
      />
      {input}
    </div>
  ) : (
    input
  );
}

function JsonValueInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TestValue;
  onChange: (value: TestValue) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setInvalid(false);
  }, [value]);
  return (
    <textarea
      aria-label={label}
      aria-invalid={invalid}
      rows={5}
      className={invalid ? 'data-json-invalid' : undefined}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        try {
          const parsed = JSON.parse(next) as TestValue;
          setInvalid(false);
          onChange(parsed);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
}
