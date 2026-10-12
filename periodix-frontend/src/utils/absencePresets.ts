import { addDays, fmtLocal } from './dates';
import type { AbsencePreset, DateRange } from '../types';

const SCHOOL_YEAR_START_MONTH = 7; // August (0-indexed)
const DEFAULT_ALL_TIME_START = '2010-01-01'; // Reasonable lower bound for "all time" queries

export const ABSENCE_PRESET_ORDER: AbsencePreset[] = [
    'thisMonth',
    'schoolYear',
    'allTime',
];

export const ABSENCE_PRESET_LABELS: Record<AbsencePreset, string> = {
    thisMonth: 'This month',
    schoolYear: 'This school year',
    allTime: 'All time',
};

// Every preset covers its whole period, including the part still ahead:
// absences can be entered in advance (trips, appointments, leave).
export function getAbsencePresetRange(
    preset: AbsencePreset,
    referenceDate = new Date()
): DateRange {
    const now = new Date(referenceDate);
    const schoolYearStartYear =
        now.getMonth() >= SCHOOL_YEAR_START_MONTH
            ? now.getFullYear()
            : now.getFullYear() - 1;
    // Last day of the school year that starts in `startYear` (31 July)
    const schoolYearEnd = (startYear: number) =>
        fmtLocal(new Date(startYear + 1, SCHOOL_YEAR_START_MONTH, 0));

    if (preset === 'thisMonth') {
        return {
            start: fmtLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
            end: fmtLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
        };
    }

    if (preset === 'schoolYear') {
        return {
            start: fmtLocal(
                new Date(schoolYearStartYear, SCHOOL_YEAR_START_MONTH, 1)
            ),
            end: schoolYearEnd(schoolYearStartYear),
        };
    }

    if (preset === 'allTime') {
        // Through the end of next school year, so absences already planned
        // beyond this one show up too
        return {
            start: DEFAULT_ALL_TIME_START,
            end: schoolYearEnd(schoolYearStartYear + 1),
        };
    }

    return {
        start: fmtLocal(addDays(now, -30)),
        end: fmtLocal(addDays(now, 60)),
    };
}
