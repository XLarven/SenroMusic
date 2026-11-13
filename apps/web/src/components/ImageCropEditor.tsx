import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Check } from 'lucide-react';
import { getAppLanguage } from '../lib/i18n';

type ImageCropEditorProps = {
  imageUrl: string;
  outputWidth: number;
  outputHeight: number;
  shape: 'circle' | 'wide';
  title: string;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
};

const STRINGS = {
  tr: {
    zoom: 'Yakınlaştır',
    reposition: 'Konumlandır',
    reset: 'Sıfırla',
    cancel: 'İptal',
    save: 'Kaydet',
    hint: 'Sürükleyerek konumlandır · fare tekerleği veya iki parmakla yakınlaştır',
    error: 'Görsel açılamadı. JPEG, PNG veya WebP seç.',
  },
  en: {
    zoom: 'Zoom',
    reposition: 'Reposition',
    reset: 'Reset',
    cancel: 'Cancel',
    save: 'Save Image',
    hint: 'Drag to reposition · mouse wheel or pinch to zoom',
    error: 'The image could not be opened. Pick a JPEG, PNG or WebP file.',
  },
};

export function ImageCropEditor({
  imageUrl,
  outputWidth,
  outputHeight,
  shape,
  title,
  onSave,
  onCancel,
}: ImageCropEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  // The parent passes inline arrow functions. Keeping them in refs stops the
  // image-loading effect from re-running on every render (that loop reloaded the
  // picture forever and made the editor unusable).
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const strings = STRINGS[getAppLanguage()] ?? STRINGS.tr;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const baseScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const scale = baseScale * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (canvas.width - width) / 2 + offset.x;
    const y = (canvas.height - height) / 2 + offset.y;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, width, height);
  }, [zoom, offset]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setReady(true);
    };
    image.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    if (ready) draw();
  }, [ready, draw]);

  const clampOffset = useCallback(
    (next: { x: number; y: number }, nextZoom = zoom) => {
      const image = imageRef.current;
      if (!image) return next;
      const scale = Math.max(outputWidth / image.naturalWidth, outputHeight / image.naturalHeight) * nextZoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const maxX = Math.max(0, (width - outputWidth) / 2);
      const maxY = Math.max(0, (height - outputHeight) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [outputHeight, outputWidth, zoom],
  );

  const updateZoom = useCallback(
    (nextZoom: number) => {
      const image = imageRef.current;
      if (!image) return;
      const zoomed = Math.max(1, Math.min(4, nextZoom));
      setZoom(zoomed);
      setOffset((current) => clampOffset(current, zoomed));
    },
    [clampOffset],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchStartRef.current = {
        distance: Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y),
        zoom,
      };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const previous = pointersRef.current.get(event.pointerId)!;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const points = [...pointersRef.current.values()];
      const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
      updateZoom((pinchStartRef.current.zoom * distance) / pinchStartRef.current.distance);
      return;
    }
    const deltaScale = outputWidth / Math.max(1, event.currentTarget.getBoundingClientRect().width);
    setOffset((current) => clampOffset({
      x: current.x + (event.clientX - previous.x) * deltaScale,
      y: current.y + (event.clientY - previous.y) * deltaScale,
    }));
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.12 : -0.12));
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') onSave(reader.result);
        };
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      0.88,
    );
  };

  return (
    <div className="image-editor" role="dialog" aria-label={title}>
      <div className="image-editor-head">
        <h3>{title}</h3>
        <button type="button" className="icon-button" onClick={onCancel} aria-label={strings.cancel}>
          <X size={16} />
        </button>
      </div>
      <div className={`image-editor-stage ${shape === 'circle' ? 'is-circle' : 'is-wide'}`}>
        <canvas
          ref={canvasRef}
          width={outputWidth}
          height={outputHeight}
          className="image-editor-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
          aria-label={strings.reposition}
        />
        {shape === 'circle' ? <div className="image-editor-circle-mask" aria-hidden="true" /> : null}
        {failed ? (
          <div className="image-editor-error">
            <span>{strings.error}</span>
            <button type="button" className="button ghost compact" onClick={() => onCancelRef.current()}>
              {strings.cancel}
            </button>
          </div>
        ) : null}
      </div>
      <p className="settings-hint">{strings.hint}</p>
      <div className="image-editor-controls">
        <button type="button" className="icon-button" onClick={() => updateZoom(zoom - 0.2)} aria-label="Azalt">
          <ZoomOut size={16} />
        </button>
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(event) => updateZoom(Number(event.target.value))}
          aria-label={strings.zoom}
          className="range"
          style={{ '--fill': `${((zoom - 1) / 3) * 100}%` } as React.CSSProperties}
        />
        <button type="button" className="icon-button" onClick={() => updateZoom(zoom + 0.2)} aria-label="Arttır">
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          aria-label={strings.reset}
          title={strings.reset}
        >
          <RotateCcw size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="image-editor-actions">
        <button type="button" className="button ghost" onClick={onCancel}>{strings.cancel}</button>
        <button type="button" className="button primary" onClick={save} disabled={!ready}>
          <Check size={16} /> {strings.save}
        </button>
      </div>
    </div>
  );
}
