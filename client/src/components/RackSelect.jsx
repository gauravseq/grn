import React, { useState, useRef, useEffect, useMemo } from 'react';

// Tap-to-open, searchable rack picker. Works on mobile (native <datalist> does
// not) and restricts selection to racks that exist in the pool. Renders only a
// filtered slice so a large rack pool stays fast. Uses a fixed-position popup so
// it is never clipped by the table's horizontal scroll container.
// Keyboard: ↓/↑ move the highlight, Enter picks it, Esc closes.
const isTouch = typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

export default function RackSelect({ value, racks, onChange, placeholder = 'select rack', width = 150, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(-1);
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
    const base = racks || [];
    const f = s ? base.filter((r) => r.toUpperCase().includes(s)) : base;
    return { list: f.slice(0, 100), total: f.length };
  }, [q, racks]);

  // Flat, ordered list — drives both render and ↑/↓ navigation.
  const rows = [];
  if (value) rows.push({ key: '__clear', cls: 'clear', value: '', label: '— clear —' });
  for (const r of opts.list) rows.push({ key: r, cls: r === value ? 'sel' : '', value: r, label: r });

  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector('.rackpop-opt.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function pick(r) { onChange(r); setOpen(false); setQ(''); setActive(-1); }
  function openPop() { reposition(); setQ(''); setActive(-1); setOpen(true); }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, (a < 0 ? rows.length : a) - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && rows[active]) pick(rows[active].value);
      else if (opts.list[0]) pick(opts.list[0]);
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <>
      <button type="button" ref={btnRef} className="rackpick" style={{ width }} disabled={disabled}
        onClick={() => { if (disabled) return; if (open) { setOpen(false); } else { openPop(); } }}>
        <span className={value ? 'v' : 'ph'}>{value || placeholder}</span>
        <span className="car" aria-hidden="true">▾</span>
      </button>
      {open && pos && (
        <div ref={popRef} className="rackpop" style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 300 }}>
          <input autoFocus={!isTouch} className="rackpop-q" value={q}
            onChange={(e) => { setQ(e.target.value); setActive(-1); }}
            onKeyDown={onKeyDown}
            placeholder="Search rack…" />
          <div className="rackpop-list" ref={listRef}>
            {rows.map((r, i) => (
              <div key={r.key}
                className={'rackpop-opt' + (r.cls ? ' ' + r.cls : '') + (i === active ? ' active' : '')}
                onMouseMove={() => { if (active !== i) setActive(i); }}
                onClick={() => pick(r.value)}>{r.label}</div>
            ))}
            {!opts.list.length && <div className="rackpop-empty">No matching rack</div>}
            {opts.total > opts.list.length && <div className="rackpop-more">+{opts.total - opts.list.length} more — keep typing to narrow</div>}
          </div>
        </div>
      )}
    </>
  );
}
