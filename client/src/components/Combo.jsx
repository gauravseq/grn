import React, { useState, useRef, useEffect, useMemo } from 'react';

// Generic tap-to-open, searchable dropdown — the same UX as RackSelect but for
// any string list (vendors, items, …). Native <datalist> dropdowns don't open
// on mobile; this does. A fixed-position popup keeps it clear of scroll clips.
//   allowFree  — let the typed text be committed as the value (add-new).
//   onType     — fires as the user types (used to drive a live filter).
//   big        — render the closed control at input size (for form fields).
const isTouch = typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

export default function Combo({
  value, options, onChange, onType, placeholder = 'select',
  width = 150, allowFree = false, mono = false, big = false,
  clearable = true, addLabel = 'Use', disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

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

  function commit(v) { onChange(v); setOpen(false); setQ(''); }
  function openPop() { reposition(); setQ(''); setOpen(true); }

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
            onChange={(e) => { setQ(e.target.value); if (onType) onType(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); if (showFree) commit(q.trim()); else if (opts.list[0]) commit(opts.list[0]); }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search…" />
          <div className="rackpop-list" style={{ fontFamily: font }}>
            {showFree && <div className="rackpop-opt free" onClick={() => commit(q.trim())}>＋ {addLabel} “{q.trim()}”</div>}
            {clearable && value && <div className="rackpop-opt clear" onClick={() => commit('')}>— clear —</div>}
            {opts.list.map((r) => <div key={r} className={'rackpop-opt' + (r === value ? ' sel' : '')} onClick={() => commit(r)}>{r}</div>)}
            {!opts.list.length && !showFree && <div className="rackpop-empty">No matches</div>}
            {opts.total > opts.list.length && <div className="rackpop-more">+{opts.total - opts.list.length} more — keep typing to narrow</div>}
          </div>
        </div>
      )}
    </>
  );
}
