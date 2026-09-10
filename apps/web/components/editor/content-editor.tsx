'use client';

/**
 * Generic shape-driven editor for one Section's content.
 *
 * The schema does not constrain content keys beyond "an object", so we edit
 * whatever the section actually carries — the same keys the renderer reads.
 * That keeps the preview honest (WYSIWYG) and the saved document stable.
 *
 * Value shapes handled recursively:
 *   string  → text input (textarea for long values)
 *   number  → numeric input
 *   boolean → checkbox
 *   array   → repeatable list (strings or objects)
 *   object  → nested group; special-cased when it carries `assetRef` (image)
 */

import { useCallback, useState } from 'react';
import { blankFor, isObject, type Path } from './editor-utils';

export interface ContentEditorProps {
  content: Record<string, unknown>;
  path: Path;
  onUpdate(path: Path, value: unknown): void;
  onRemove(path: Path): void;
  assets: Array<{ id: string; url: string; kind: string; alt?: string; category?: string }>;
}

export function ContentEditor({ content, path, onUpdate, onRemove, assets }: ContentEditorProps) {
  const entries = Object.entries(content);
  if (entries.length === 0) {
    return <p className="editor-empty">This section has no editable content.</p>;
  }
  return (
    <div className="field-group">
      {entries.map(([key, value]) => (
        <ValueRow
          key={key}
          label={key}
          value={value}
          path={[...path, key]}
          onUpdate={onUpdate}
          onRemove={onRemove}
          assets={assets}
        />
      ))}
    </div>
  );
}

interface ValueRowProps {
  label: string;
  value: unknown;
  path: Path;
  onUpdate(path: Path, value: unknown): void;
  onRemove(path: Path): void;
  assets: Array<{ id: string; url: string; kind: string; alt?: string; category?: string }>;
}

function ValueRow({ label, value, path, onUpdate, onRemove, assets }: ValueRowProps) {
  const remove = useCallback(() => onRemove(path), [onRemove, path]);

  if (Array.isArray(value)) {
    return <ListField label={label} value={value} path={path} onUpdate={onUpdate} onRemove={remove} assets={assets} />;
  }
  if (isObject(value)) {
    if (typeof value.assetRef === 'string' && Object.keys(value).length <= 2) {
      return <AssetField label={label} value={value} path={path} onUpdate={onUpdate} assets={assets} />;
    }
    return (
      <details className="field-group-block" open>
        <summary className="summary-row">
          <span className="field-label">{label}</span>
          <button type="button" className="icon-btn" onClick={remove} aria-label={`Remove ${label}`}>
            ✕
          </button>
        </summary>
        <ContentEditor content={value} path={path} onUpdate={onUpdate} onRemove={onRemove} assets={assets} />
      </details>
    );
  }
  if (typeof value === 'string') return <StringField label={label} value={value} path={path} onUpdate={onUpdate} />;
  if (typeof value === 'number') return <NumberField label={label} value={value} path={path} onUpdate={onUpdate} />;
  if (typeof value === 'boolean') return <BooleanField label={label} value={value} path={path} onUpdate={onUpdate} />;
  return (
    <div className="field-row readonly">
      <span className="field-label">{label}</span>
      <span className="readonly-value">Ø</span>
    </div>
  );
}

function StringField({
  label,
  value,
  path,
  onUpdate,
}: {
  label: string;
  value: string;
  path: Path;
  onUpdate(path: Path, value: unknown): void;
}) {
  const long = value.length > 80;
  const set = useCallback((next: string) => onUpdate(path, next), [onUpdate, path]);
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      {long ? (
        <textarea rows={3} value={value} onChange={(e) => set(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => set(e.target.value)} />
      )}
    </label>
  );
}

function NumberField({
  label,
  value,
  path,
  onUpdate,
}: {
  label: string;
  value: number;
  path: Path;
  onUpdate(path: Path, value: unknown): void;
}) {
  const set = useCallback((raw: string) => {
    const n = Number(raw);
    onUpdate(path, Number.isFinite(n) ? n : 0);
  }, [onUpdate, path]);
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <input type="number" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
}

function BooleanField({
  label,
  value,
  path,
  onUpdate,
}: {
  label: string;
  value: boolean;
  path: Path;
  onUpdate(path: Path, value: unknown): void;
}) {
  const set = useCallback((next: boolean) => onUpdate(path, next), [onUpdate, path]);
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}

function ListField({
  label,
  value,
  path,
  onUpdate,
  onRemove,
  assets,
}: {
  label: string;
  value: unknown[];
  path: Path;
  onUpdate(path: Path, value: unknown): void;
  onRemove(): void;
  assets: Array<{ id: string; url: string; kind: string; alt?: string; category?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const addItem = useCallback(() => {
    const sample = value[0];
    onUpdate(path, [...value, blankFor(sample)]);
  }, [value, path, onUpdate]);

  return (
    <div className="field-list">
      <div className="summary-row">
        <span className="field-label">
          {label} <em className="field-count">({value.length})</em>
        </span>
        <span className="list-actions">
          {value.length > 0 && (
            <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove ${label}`}>
              ✕
            </button>
          )}
          <button type="button" className="tiny-btn" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Edit'}
          </button>
          <button type="button" className="tiny-btn" onClick={addItem}>
            + Add
          </button>
        </span>
      </div>
      {open && (
        <div className="list-items">
          {value.map((item, index) => (
            <div className="list-item" key={String(index)}>
              <span className="list-index">{index}</span>
              {isObject(item) ? (
                <ContentEditor
                  content={item}
                  path={[...path, index]}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                  assets={assets}
                />
              ) : (
                <StringField label={`item ${index}`} value={String(item)} path={[...path, index]} onUpdate={onUpdate} />
              )}
              <button
                type="button"
                className="icon-btn"
                onClick={() => onUpdate(path, value.filter((_, i) => i !== index))}
                aria-label={`Remove item ${index}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetField({
  label,
  value,
  path,
  onUpdate,
  assets,
}: {
  label: string;
  value: Record<string, unknown>;
  path: Path;
  onUpdate(path: Path, value: unknown): void;
  assets: Array<{ id: string; url: string; kind: string; alt?: string; category?: string }>;
}) {
  const [browse, setBrowse] = useState(false);
  const assetRef = String(value.assetRef ?? '');

  const pick = useCallback((url: string) => {
    onUpdate(path, {
      ...value,
      assetRef: url,
      alt: typeof value.alt === 'string' && value.alt !== '' ? value.alt : String(value.assetRef ?? url),
    });
    setBrowse(false);
  }, [value, path, onUpdate]);

  const stock = assets.filter((a) => a.kind === 'illustration' || a.kind === 'image');

  return (
    <div className="field-asset">
      <div className="summary-row">
        <span className="field-label">{label}</span>
        <button type="button" className="tiny-btn" onClick={() => setBrowse((b) => !b)}>
          {browse ? 'Close' : 'Browse stock'}
        </button>
      </div>
      {assetRef !== '' && (
        <div className="asset-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetRef} alt="" width={120} height={80} style={{ objectFit: 'cover' }} />
        </div>
      )}
      <input
        value={assetRef}
        onChange={(e) => onUpdate(path, { ...value, assetRef: e.target.value })}
        placeholder="Image URL or asset reference"
        aria-label={`${label} reference`}
      />
      {typeof value.alt === 'string' && (
        <input
          value={value.alt}
          onChange={(e) => onUpdate(path, { ...value, alt: e.target.value })}
          placeholder="Alt text"
          aria-label={`${label} alt`}
        />
      )}
      {browse && (
        <div className="asset-grid">
          {stock.map((asset) => (
            <button
              type="button"
              key={asset.id}
              className="asset-cell"
              onClick={() => pick(asset.url)}
              aria-label={asset.id}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={asset.alt ?? asset.id} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <style jsx>{`
        .field-asset { display: grid; gap: 6px; }
        .asset-thumb img { border: 1px solid var(--color-border); border-radius: var(--radius-sm); display: block; }
        .asset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .asset-cell { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 2px; background: var(--color-surface); cursor: pointer; }
        .asset-cell img { width: 100%; height: auto; display: block; }
      `}</style>
    </div>
  );
}