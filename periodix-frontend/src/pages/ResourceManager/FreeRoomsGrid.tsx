import { useMemo, useState } from 'react';
import type { FreeRoomSlotState, FreeRoomsResponse } from '../../types';
import { fmtHM, untisToMinutes } from '../../utils/dates';

const CELL_CLASS: Record<FreeRoomSlotState, string> = {
    free: 'bg-emerald-100/70 dark:bg-emerald-900/30',
    busy: 'bg-slate-300 dark:bg-slate-600',
    shared: 'bg-amber-300 dark:bg-amber-600/70',
    conflict: 'bg-rose-400 dark:bg-rose-600',
};

const LEGEND: Array<[FreeRoomSlotState, string]> = [
    ['free', 'Free'],
    ['busy', 'Occupied'],
    ['shared', 'Combined lessons'],
    ['conflict', 'Double-booked'],
];

type Props = {
    data: FreeRoomsResponse;
    onOpenRoom: (roomId: number) => void;
};

export default function FreeRoomsGrid({ data, onOpenRoom }: Props) {
    const [query, setQuery] = useState('');
    const [onlyFreeIn, setOnlyFreeIn] = useState<number | null>(null);
    const [hideUnused, setHideUnused] = useState(true);

    const nowPeriod = useMemo(() => {
        const now = new Date();
        const today =
            now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        if (today !== data.date) return null;
        const hm = now.getHours() * 100 + now.getMinutes();
        const idx = data.periods.findIndex((p) => hm >= p.startTime && hm < p.endTime);
        return idx >= 0 ? idx : null;
    }, [data]);

    const rooms = useMemo(() => {
        const q = query.trim().toLowerCase();
        return data.rooms.filter((room) => {
            if (q && !room.name.toLowerCase().includes(q) && !room.longName.toLowerCase().includes(q)) {
                return false;
            }
            if (onlyFreeIn !== null && room.slots[onlyFreeIn]?.state !== 'free') return false;
            // Rooms nobody uses all day are mostly storage / special rooms
            if (hideUnused && onlyFreeIn === null && room.slots.every((s) => s.state === 'free')) {
                return false;
            }
            return true;
        });
    }, [data.rooms, query, onlyFreeIn, hideUnused]);

    const conflicts = data.rooms.reduce(
        (n, r) => n + r.slots.filter((s) => s.state === 'conflict').length,
        0,
    );

    if (!data.periods.length) {
        return (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No period grid available for this day.
            </p>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 sm:w-56 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    placeholder="Filter rooms…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={hideUnused}
                        onChange={(e) => setHideUnused(e.target.checked)}
                    />
                    Hide rooms unused all day
                </label>
                {onlyFreeIn !== null && (
                    <button
                        type="button"
                        onClick={() => setOnlyFreeIn(null)}
                        className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                    >
                        Free in period {data.periods[onlyFreeIn]?.name} ✕
                    </button>
                )}
                {conflicts > 0 && (
                    <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        {conflicts} double booking{conflicts === 1 ? '' : 's'}
                    </span>
                )}
                <div className="ml-auto flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {LEGEND.map(([state, label]) => (
                        <span key={state} className="flex items-center gap-1.5">
                            <span className={`inline-block h-3 w-3 rounded-sm ${CELL_CLASS[state]}`} />
                            {label}
                        </span>
                    ))}
                </div>
            </div>

            <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead>
                        <tr>
                            <th className="sticky left-0 top-0 z-20 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                Room
                            </th>
                            {data.periods.map((p, i) => (
                                <th
                                    key={p.name}
                                    className={`sticky top-0 z-10 px-1 py-1 text-center font-medium ${
                                        i === nowPeriod
                                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200'
                                            : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        className="w-full rounded px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700"
                                        onClick={() => setOnlyFreeIn(onlyFreeIn === i ? null : i)}
                                        title="Show only rooms free in this period"
                                    >
                                        <div>{p.name}</div>
                                        <div className="font-normal opacity-70">
                                            {fmtHM(untisToMinutes(p.startTime))}
                                        </div>
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rooms.map((room) => (
                            <tr key={room.id}>
                                <th className="sticky left-0 z-10 max-w-[11rem] border-t border-slate-100 bg-white px-3 py-1 text-left font-normal dark:border-slate-700/60 dark:bg-slate-900">
                                    <button
                                        type="button"
                                        className="block w-full truncate text-left hover:text-sky-600 dark:hover:text-sky-400"
                                        onClick={() => onOpenRoom(room.id)}
                                        title={`Open timetable of ${room.longName}`}
                                    >
                                        <span className="font-medium text-slate-800 dark:text-slate-100">
                                            {room.name}
                                        </span>
                                        {room.longName !== room.name && (
                                            <span className="ml-1.5 text-slate-400">{room.longName}</span>
                                        )}
                                    </button>
                                </th>
                                {room.slots.map((slot, i) => (
                                    <td
                                        key={i}
                                        className={`border-t border-l border-white p-0 dark:border-slate-900 ${
                                            i === nowPeriod ? 'ring-1 ring-inset ring-sky-400' : ''
                                        }`}
                                    >
                                        <div
                                            className={`h-7 min-w-[2.5rem] ${CELL_CLASS[slot.state]}`}
                                            title={
                                                slot.lessons.length
                                                    ? slot.lessons
                                                          .map(
                                                              (l) =>
                                                                  `${l.subject} · ${l.classes.join(', ')} · ${l.teachers.join(', ')}`,
                                                          )
                                                          .join('\n')
                                                    : 'Free'
                                            }
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {rooms.length === 0 && (
                            <tr>
                                <td
                                    colSpan={data.periods.length + 1}
                                    className="px-3 py-6 text-center text-slate-500 dark:text-slate-400"
                                >
                                    No rooms match.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
