export { TEMPERAMENT_LABEL, coursePrefix, coursesFor, departmentCourses, gstCourses, levelYear } from "./academics/courses";
export type { Course, Lecturer, Temperament } from "./academics/courses";
export { CLASS_MINUTES, CLASS_START_HOURS, CLASS_VENUES, GST_VENUES, SLOTS_PER_DAY, WEEK_SLOTS, slotIndexOf, slotStart, slotWeekday, timetableFor } from "./academics/timetable";
export type { ClassSlot, StudentTimetable } from "./academics/timetable";
export {
  LATE_MAX_MINUTES,
  LATE_MIN_MINUTES,
  NOSHOW_REVEAL_MINUTES,
  SHEET_WINDOW_MINUTES,
  SNAP_WINDOW_MINUTES,
  classPhase,
  classesOn,
  gstClassesOn,
  rollClass,
  sheetGoingRound,
  snapTestOn,
} from "./academics/day";
export type { ClassPhase, ClassRoll, ClassStatus, DayClass } from "./academics/day";
export {
  ATTENDANCE_PENALTY_CAP,
  ATTENDANCE_PENALTY_MARKS,
  ATTENDANCE_RULE_MIN_CLASSES,
  ATTENDANCE_RULE_PERCENT,
  attendancePenalty,
  attendancePercent,
  attendanceShare,
  belowAttendanceRule,
  courseAttendance,
  markHeld,
  markSigned,
  markSnap,
  parseClassesPayload,
  sanitizeBook,
  signedSession,
} from "./academics/attendance";
export type { AttendanceBook, ClassesPayload } from "./academics/attendance";
