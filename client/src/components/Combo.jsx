import React, { useState, useRef, useEffect, useMemo } from 'react';

// Generic tap-to-open, searchable dropdown — the same UX as RackSelect but for
// any string list (vendors, items, …). Native <datalist> dropdowns don't open
// on mobile; this does. A fixed-position popup keeps it clear of scroll clips.
//   allowFree  — let the typed text be committed as the value (add-new).
//   onType     — fires as the user types (used to drive a live filter).
//   big        — render the closed control at input size (for form fields).
// Keyboard: ↓/↑ move the highlight, Enter picks it, Esc closes.
const isTouch = typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

export default function Combo({
  value, options, onChange, onType, placeholder = 'select',
  width = 150, allowFree = false, mono = false, big = false,
  clearable = true, addLabel = 'Use', disabled = false, emptyText = 'No matches',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(-1); // highlighted row index (-1 = none)
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const listRef = useRef(null);

  function reposition() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const popW = Math.min(Math.max(210, r.width), window.innerWidth - 16);
    let left = r.left; if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (left < 8) left = 8;
    const below = window.innerHeight - r.bottom;
    const top = below > 300 ? r.bottom + 2 : Math.max(8, r.top - 302);
    setPos({ left, top, width: popW });
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onMove = () => reposition();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const opts = useMemo(() => {
    const s = q.trim().toUpperCase();
    const base = options || [];
    const f = s ? base.filter((r) => String(r).toUpperCase().includes(s)) : base;
    return { list: f.slice(0, 100), total: f.length, exact: base.some((r) => String(r).toUpperCase() === s) };
  }, [q, options]);

  const showFree = allowFree && q.trim() && !opts.exact;
  const font = mono ? 'var(--mono)' : 'inherit';

  // Flat, ordered list of everything selectable — drives both render and ↑/↓.
  const rows = [];
  if (showFree) rows.push({ key: '__free', cls: 'free', value: q.trim(), label: `＋ ${addLabel} “${q.trim()}”` });
  if (clearable && value) rows.push({ key: '__clear', cls: 'clear', value: '', label: '— clear —' });
  for (const o of opts.list) rows.push({ key: o, cls: o === value ? 'sel' : '', value: o, label: o });

  // Keep the highlighted row scrolled into view as you arrow through.
  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector('.rackpop-opt.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function commit(v) { onChange(v); setOpen(false); setQ(''); setActive(-1); }
  function openPop() { reposition(); setQ(''); setActive(-1); setOpen(true); }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, (a < 0 ? rows.length : a) - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && rows[active]) commit(rows[active].value);
      else if (showFree) commit(q.trim());
      else if (opts.list[0]) commit(opts.list[0]);
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <>
      <button type="button" ref={btnRef} disabled={disabled}
        className={'rackpick' + (big ? ' combo-big' : '')} style={{ width, fontFamily: font }}
        onClick={() => { if (disabled) return; if (open) setOpen(false); else openPop(); }}>
        <span className={value ? 'v' : 'ph'}>{value || placeholder}</span>
        <span className="car" aria-hidden="true">▾</span>
      </button>
      {open && pos && (
        <div ref={popRef} className="rackpop" style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 300 }}>
          <input autoFocus={!isTouch} className="rackpop-q" style={{ fontFamily: font }}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(-1); if (onType) onType(e.target.value); }}
            onKeyDown={onKeyDown}
            placeholder="Search…" />
          <div className="rackpop-list" ref={listRef} style={{ fontFamily: font }}>
            {rows.map((r, i) => (
              <div key={r.key}
                className={'rackpop-opt' + (r.cls ? ' ' + r.cls : '') + (i === active ? ' active' : '')}
                onMouseMove={() => { if (active !== i) setActive(i); }}
                onClick={() => commit(r.value)}>{r.label}</div>
            ))}
            {!opts.list.length && !showFree && <div className="rackpop-empty">{q.trim() ? 'No matches' : emptyText}</div>}
            {opts.total > opts.list.length && <div className="rackpop-more">+{opts.total - opts.list.length} more — keep typing to narrow</div>}
          </div>
        </div>
      )}
    </>
  );
}
