import React, { useState, useRef, useEffect, useMemo } from 'react';

// Tap-to-open, searchable rack picker. Works on mobile (native <datalist> does
// not) and restricts selection to racks that exist in the pool. Renders only a
// filtered slice so a large rack pool stays fast. Uses a fixed-position popup so
// it is never clipped by the table's horizontal scroll container.
const isTouch = typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

export default function RackSelect({ value, racks, onChange, placeholder = 'select rack', width = 150, disabled = false }) {
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
    const base = racks || [];
    const f = s ? base.filter((r) => r.toUpperCase().includes(s)) : base;
    return { list: f.slice(0, 100), total: f.length };
  }, [q, racks]);

  function pick(r) { onChange(r); setOpen(false); }

  return (
    <>
      <button type="button" ref={btnRef} className="rackpick" style={{ width }} disabled={disabled}
        onClick={() => { if (disabled) return; if (open) { setOpen(false); } else { reposition(); setQ(''); setOpen(true); } }}>
        <span className={value ? 'v' : 'ph'}>{value || placeholder}</span>
        <span className="car" aria-hidden="true">▾</span>
      </button>
      {open && pos && (
        <div ref={popRef} className="rackpop" style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 300 }}>
          <input autoFocus={!isTouch} className="rackpop-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rack…" />
          <div className="rackpop-list">
            {value && <div className="rackpop-opt clear" onClick={() => pick('')}>— clear —</div>}
            {opts.list.map((r) => <div key={r} className={'rackpop-opt' + (r === value ? ' sel' : '')} onClick={() => pick(r)}>{r}</div>)}
            {!opts.list.length && <div className="rackpop-empty">No matching rack</div>}
            {opts.total > opts.list.length && <div className="rackpop-more">+{opts.total - opts.list.length} more — keep typing to narrow</div>}
          </div>
        </div>
      )}
    </>
  );
}
