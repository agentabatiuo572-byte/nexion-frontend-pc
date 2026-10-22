"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { dateInput } from '@/lib/admin/promotion-form';

const pad = (value: number) => String(value).padStart(2, '0');
const dayText = (date: Date) => date.toISOString().split('T')[0];

/** Edits a local wall-clock value. UTC conversion remains at the existing call site. */
export function H4DateTimeField({ label, hint, value, timeZone, onChange, disabled = false, readOnly = false, required = false }: {
    label: string;
    hint?: ReactNode;
    value: string;
    timeZone: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
}) {
    const id = useId(), trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
    const [open, setOpen] = useState(false), [draft, setDraft] = useState(''), [month, setMonth] = useState('');
    const selectedDay = draft.slice(0, 10), hours = draft.slice(11, 13), minutes = draft.slice(14, 16);
    const close = () => setOpen(false);
    const show = () => {
        if (disabled || readOnly || trigger.current?.matches(':disabled')) return;
        const initial = value || dateInput(new Date().toISOString(), timeZone);
        setDraft(initial); setMonth(initial.slice(0, 7)); setOpen(true);
    };
    useEffect(() => {
        if (!open) return;
        const node = dialog.current;
        node?.showModal();
        node?.querySelector<HTMLButtonElement>(`[data-day="${selectedDay}"]`)?.focus();
        return () => { node?.close(); trigger.current?.focus(); };
    }, [open]);
    useEffect(() => {
        if (open && dialog.current?.open) dialog.current.querySelector<HTMLButtonElement>(`[data-day="${selectedDay}"]`)?.focus();
    }, [selectedDay, open]);
    useEffect(() => { if (disabled || readOnly) setOpen(false); }, [disabled, readOnly]);

    const moveMonth = (amount: number) => {
        const next = new Date(`${month}-01T00:00:00Z`);
        next.setUTCMonth(next.getUTCMonth() + amount);
        if (next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999) setMonth(dayText(next).slice(0, 7));
    };
    const selectDay = (day: string) => { setDraft(`${day}T${hours}:${minutes}`); setMonth(day.slice(0, 7)); };
    const navigateDay = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
        const date = new Date(`${day}T00:00:00Z`);
        const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getUTCDay(), End: 6 - date.getUTCDay() } as Record<string, number>)[event.key];
        if (delta === undefined) return;
        event.preventDefault(); date.setUTCDate(date.getUTCDate() + delta);
        if (date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999) selectDay(dayText(date));
    };
    const commit = (next: string) => { if (!disabled && !readOnly && !trigger.current?.matches(':disabled')) onChange(next); close(); };
    const start = new Date(`${month}-01T00:00:00Z`);
    const days = open ? Array.from({ length: 42 }, (_, index) => {
        const day = new Date(start); day.setUTCDate(index - start.getUTCDay() + 1); return day;
    }) : [];

    return <div className="field h4-datetime-field">
        <span id={`${id}-label`}>{label}</span>
        <button ref={trigger} type="button" className="h4-datetime-trigger" disabled={disabled} aria-disabled={readOnly || undefined}
            aria-labelledby={`${id}-label ${id}-value`} aria-describedby={hint ? `${id}-hint` : undefined}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-dialog`} onClick={show}>
            <span id={`${id}-value`}>{value ? value.replace('T', ' ').replaceAll('-', '/') : '请选择日期和时间'}</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></svg>
        </button>
        {hint && <small id={`${id}-hint`}>{hint}</small>}
        {required && <input className="h4-datetime-validation" aria-hidden="true" tabIndex={-1} value={value} required disabled={disabled || readOnly}
            onChange={() => undefined} onInvalid={event => {
                event.preventDefault();
                if (event.currentTarget.form?.querySelector(':invalid') === event.currentTarget) show();
            }}/>}
        {open && <dialog ref={dialog} id={`${id}-dialog`} className="h4-datetime-dialog" aria-labelledby={`${id}-title`}
            onCancel={event => { event.preventDefault(); close(); }}>
            <div className="dialog-head"><h2 id={`${id}-title`}>选择{label.replace(/\s*\*$/, '')}</h2><button type="button" className="close" aria-label="关闭日期时间选择" onClick={close}>×</button></div>
            <div className="h4-datetime-body">
                <p className="muted">时区：{({ UTC: '协调世界时（UTC）', 'Asia/Tokyo': '日本时间', 'Asia/Ho_Chi_Minh': '越南时间' } as Record<string, string>)[timeZone] || timeZone}</p>
                <div className="h4-calendar-heading"><button type="button" className="btn" aria-label="上个月" disabled={month === '0001-01'} onClick={() => moveMonth(-1)}>‹</button><strong aria-live="polite">{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</strong><button type="button" className="btn" aria-label="下个月" disabled={month === '9999-12'} onClick={() => moveMonth(1)}>›</button></div>
                <div className="h4-calendar-week" aria-hidden="true">{['日', '一', '二', '三', '四', '五', '六'].map(day => <span key={day}>{day}</span>)}</div>
                <div className="h4-calendar-days" role="group" aria-label="选择日期，方向键移动日期">
                    {days.map(date => {
                        const day = dayText(date), outside = day.slice(0, 7) !== month, selected = day === selectedDay;
                        return <button type="button" key={day} data-day={day} aria-label={`${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`}
                            aria-pressed={selected} tabIndex={(selectedDay.slice(0, 7) === month ? selected : date.getUTCDate() === 1 && !outside) ? 0 : -1}
                            disabled={date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999} className={`${outside ? 'outside' : ''} ${selected ? 'selected' : ''}`}
                            onClick={() => selectDay(day)} onKeyDown={event => navigateDay(event, day)}>{date.getUTCDate()}</button>;
                    })}
                </div>
                <div className="h4-time-select"><label>时<select value={hours} onChange={event => setDraft(`${selectedDay}T${event.target.value}:${minutes}`)}>{Array.from({ length: 24 }, (_, hour) => <option value={pad(hour)} key={hour}>{pad(hour)}</option>)}</select></label><span aria-hidden="true">:</span><label>分<select value={minutes} onChange={event => setDraft(`${selectedDay}T${hours}:${event.target.value}`)}>{Array.from({ length: 60 }, (_, minute) => <option value={pad(minute)} key={minute}>{pad(minute)}</option>)}</select></label></div>
                <p className="h4-datetime-preview" aria-live="polite">已选：{draft.replace('T', ' ')}</p>
            </div>
            <div className="dialog-foot"><button type="button" className="btn" onClick={() => commit('')}>清空</button><button type="button" className="btn" onClick={close}>取消</button><button type="button" className="btn primary" onClick={() => commit(draft)}>确认</button></div>
        </dialog>}
    </div>;
}
