import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResourceSummary, ResourceType } from '../../types';

type Props = {
    type: ResourceType;
    resources: ResourceSummary[];
    selectedId: number | null;
    recentIds: number[];
    onSelect: (id: number) => void;
};

const MAX_RESULTS = 60;

export default function ResourcePicker({
    type,
    resources,
    selectedId,
    recentIds,
    onSelect,
}: Props) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const boxRef = useRef<HTMLDivElement | null>(null);

    const byId = useMemo(
        () => new Map(resources.map((r) => [r.id, r])),
        [resources],
    );
    const selected = selectedId !== null ? byId.get(selectedId) : undefined;

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q
            ? resources.filter(
                  (r) =>
                      r.name.toLowerCase().includes(q) ||
                      r.longName.toLowerCase().includes(q),
              )
            : resources;
        return list.slice(0, MAX_RESULTS);
    }, [resources, query]);

    useEffect(() => setHighlight(0), [query, open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const choose = (id: number) => {
        onSelect(id);
        setQuery('');
        setOpen(false);
    };

    const recents = recentIds
        .filter((id) => id !== selectedId)
        .map((id) => byId.get(id))
        .filter((r): r is ResourceSummary => !!r)
        .slice(0, 5);

    const placeholder =
        type === 'teacher' ? 'Search teacher…' : 'Search room…';

    return (
        <div className="flex flex-col gap-2 min-w-0 flex-1">
            <div ref={boxRef} className="relative w-full sm:max-w-sm">
                <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    placeholder={
                        selected
                            ? `${selected.name} · ${selected.longName}`
                            : placeholder
                    }
                    value={query}
                    onFocus={() => setOpen(true)}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlight((h) => Math.min(h + 1, matches.length - 1));
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlight((h) => Math.max(h - 1, 0));
                        } else if (e.key === 'Enter') {
                            const target = matches[highlight];
                            if (target) choose(target.id);
                        } else if (e.key === 'Escape') {
                            setOpen(false);
                        }
                    }}
                    aria-label={placeholder}
                />
                {open && (
                    <ul className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                        {matches.length === 0 && (
                            <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                                No match in this week's data
                            </li>
                        )}
                        {matches.map((r, i) => (
                            <li key={r.id}>
                                <button
                                    type="button"
                                    className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm ${
                                        i === highlight
                                            ? 'bg-sky-50 dark:bg-sky-900/30'
                                            : ''
                                    } ${
                                        r.id === selectedId
                                            ? 'text-sky-700 dark:text-sky-300'
                                            : 'text-slate-800 dark:text-slate-100'
                                    }`}
                                    onMouseEnter={() => setHighlight(i)}
                                    onClick={() => choose(r.id)}
                                >
                                    <span className="w-24 shrink-0 truncate font-medium">
                                        {r.name}
                                    </span>
                                    <span className="flex-1 truncate text-slate-500 dark:text-slate-400">
                                        {r.longName !== r.name ? r.longName : ''}
                                    </span>
                                    <span className="shrink-0 text-xs tabular-nums text-slate-400">
                                        {r.lessonCount}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {recents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {recents.map((r) => (
                        <button
                            key={r.id}
                            type="button"
                            onClick={() => choose(r.id)}
                            className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                            title={r.longName}
                        >
                            {r.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
