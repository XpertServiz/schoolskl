/** Shape of public.setup_progress() — counts only. */
export interface Progress { profile: boolean; campuses: number; session: boolean; classes: number; sections: number; fees: number; students: number; staff: number; timetable: number }

/** Steps that count towards "N of M done" on the setup page and the cockpit banner (the timetable is optional, so not counted). */
export function setupSteps(pr: Partial<Progress>, mfaOn: boolean) {
  return [
    { key: 'profile', done: !!pr.profile },
    { key: 'campuses', done: (pr.campuses ?? 0) > 0 },
    { key: 'session', done: !!pr.session },
    { key: 'classes', done: (pr.classes ?? 0) > 0 && (pr.sections ?? 0) > 0 },
    { key: 'fees', done: (pr.fees ?? 0) > 0 },
    { key: 'students', done: (pr.students ?? 0) > 0 },
    { key: 'staff', done: (pr.staff ?? 0) > 0 },
    { key: 'security', done: mfaOn },
  ];
}
