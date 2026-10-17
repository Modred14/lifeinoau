export interface OauCourse { code: string; title: string; subject: string; difficulty: number; lecturer: { name: string; difficulty: number }; }
export function coursesFor(faculty: string, level: number, difficulty?: number): OauCourse[];
