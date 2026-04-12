import { useEffect, useState, useMemo } from 'react';
import type { User, AggregatedResourcesResponse, TeacherResource, RoomResource, ResourceLesson } from '../../types';
import { getAggregatedResources } from '../../api';
import Spinner from '../../components/Spinner';

interface ResourceManagerProps {
    token: string;
    user: User;
}

type ViewMode = 'teachers' | 'rooms';

export default function ResourceManager({ token, user }: ResourceManagerProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<AggregatedResourcesResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<ViewMode>('teachers');
    const [search, setSearch] = useState('');
    const [selectedTeacher, setSelectedTeacher] = useState<TeacherResource | null>(null);
    const [selectedRoom, setSelectedRoom] = useState<RoomResource | null>(null);

    useEffect(() => {
        if (!user.isUserManager && !user.isAdmin) {
            setError("Access Restricted: You do not have permission to view this page.");
            setLoading(false);
            return;
        }

        getAggregatedResources(token)
            .then(setData)
            .catch((err: any) => setError(err.message || 'Failed to load resources'))
            .finally(() => setLoading(false));
    }, [token, user]);

    const filteredTeachers = useMemo(() => {
        if (!data) return [];
        if (!search) return data.teachers;
        const s = search.toLowerCase();
        return data.teachers.filter((t: TeacherResource) => t.name.toLowerCase().includes(s) || t.id.toLowerCase().includes(s));
    }, [data, search]);

    const filteredRooms = useMemo(() => {
        if (!data) return [];
        if (!search) return data.rooms;
        const s = search.toLowerCase();
        return data.rooms.filter((r: RoomResource) => r.name.toLowerCase().includes(s) || r.id.toLowerCase().includes(s));
    }, [data, search]);

    if(loading) return <div className="flex justify-center p-8"><Spinner /></div>;
    if(error) return <div className="p-4 text-red-500 bg-red-100 rounded">{error}</div>;
    if(!data) return null;

    return (
        <div className="p-4 max-w-7xl mx-auto dark:text-gray-100">
            <h1 className="text-2xl font-bold mb-4">Resource Manager</h1>
            
            <div className="flex gap-4 mb-6 border-b dark:border-gray-700">
                <button 
                    onClick={() => { setMode('teachers'); setSelectedTeacher(null); setSelectedRoom(null); }}
                    className={`px-4 py-2 border-b-2 ${mode === 'teachers' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent hover:text-gray-600 dark:hover:text-gray-300'}`}
                >
                    Teachers
                </button>
                <button 
                    onClick={() => { setMode('rooms'); setSelectedTeacher(null); setSelectedRoom(null); }}
                    className={`px-4 py-2 border-b-2 ${mode === 'rooms' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent hover:text-gray-600 dark:hover:text-gray-300'}`}
                >
                    Rooms
                </button>
            </div>

            <div className="mb-4">
                 <input
                    type="text"
                    placeholder={`Search ${mode}...`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full md:w-1/3 px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
            </div>

            {mode === 'teachers' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                     {filteredTeachers.map((teacher: TeacherResource) => (
                         <div 
                            key={teacher.id} 
                            onClick={() => setSelectedTeacher(teacher)}
                            className="p-4 border rounded cursor-pointer hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 transition"
                        >
                            <h3 className="font-semibold text-lg">{teacher.name}</h3>
                            <p className="text-gray-500 text-sm">ID: {teacher.id}</p>
                            <p className="text-gray-500 text-sm">{teacher.lessons.length} scheduled lessons</p>
                         </div>
                     ))}
                </div>
            )}

             {mode === 'rooms' && (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usage</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-900 dark:divide-gray-700">
                            {filteredRooms.map((room: RoomResource) => (
                                <tr key={room.id} onClick={() => setSelectedRoom(room)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{room.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{room.lessons.length} lessons</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {/* Simple current status logic could go here */}
                                        Active
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modal or Details View could be better, for now just inline below or new screen section? 
                User asked for "click on a teacher and see thier estimated day timetable" 
            */}
            
            {selectedTeacher && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedTeacher(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-lg max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">{selectedTeacher.name} - Estimated Timetable</h2>
                            <button onClick={() => setSelectedTeacher(null)} className="text-gray-500 hover:text-gray-700">&times;</button>
                        </div>
                        <LessonList lessons={selectedTeacher.lessons} />
                    </div>
                </div>
            )}

            {selectedRoom && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedRoom(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-lg max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">{selectedRoom.name} - Occupancy</h2>
                            <button onClick={() => setSelectedRoom(null)} className="text-gray-500 hover:text-gray-700">&times;</button>
                        </div>
                         <LessonList lessons={selectedRoom.lessons} showTeacher />
                    </div>
                </div>
            )}
        </div>
    );
}

function LessonList({ lessons, showTeacher }: { lessons: ResourceLesson[], showTeacher?: boolean }) {
    // Sort by date then time
    const sorted = [...lessons].sort((a, b) => {
        if (a.date !== b.date) return a.date - b.date;
        return a.startTime - b.startTime;
    });

    if (sorted.length === 0) return <p className="text-gray-500">No lessons found.</p>;

    return (
        <div className="space-y-2">
            {sorted.map((lesson, idx) => (
                <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-800 rounded border dark:border-gray-700 flex flex-col md:flex-row md:items-center gap-2">
                    <div className="w-32 font-mono text-sm">
                        {lesson.date} <br/>
                        {formatUntisTime(lesson.startTime)} - {formatUntisTime(lesson.endTime)}
                    </div>
                    <div className="flex-1">
                        <div className="font-medium text-indigo-600 dark:text-indigo-400">
                            {lesson.subjects.join(', ')}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-300">
                             {showTeacher && <span className="mr-2">👨‍🏫 {lesson.teachers.join(', ')}</span>}
                             <span className="mr-2">🏫 {lesson.rooms.join(', ')}</span>
                             <span>🎓 {lesson.classes.join(', ')}</span>
                        </div>
                        {lesson.code === 'cancelled' && <span className="text-red-500 text-xs font-bold uppercase">Cancelled</span>}
                    </div>
                </div>
            ))}
        </div>
    );
}

function formatUntisTime(t: number): string {
    const s = t.toString().padStart(3, '0'); // 740 -> 0740, 1200 -> 1200
    const hours = s.slice(0, s.length - 2);
    const mins = s.slice(s.length - 2);
    return `${hours}:${mins}`;
}
