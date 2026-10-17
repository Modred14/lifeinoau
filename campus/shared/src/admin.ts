export { ADMIN_RESULTS_KEPT, HUSTLE_IDS, emptyAdminRecord, rollAdminWeek, sanitizeAdminRecord } from "./admin/record";
export type { AdminRecord, AdminResult, HustleId, RegistrationVia } from "./admin/record";
export {
  PORTAL_TEXT,
  PORTAL_TROUBLE,
  REGISTRATION,
  adminWeek,
  adminWeekMinute,
  adminWeekOf,
  isRegistered,
  portalRush,
  portalStatus,
  registrationClosesIn,
  registrationCost,
  registrationOpen,
  tryRegister,
  unregisteredPenalty,
} from "./admin/portal";
export type { PortalState, PortalStatus, RegisterOutcome } from "./admin/portal";
export {
  BED_HALLS,
  BED_SPACE,
  BED_TEXT,
  PORTER_RAID,
  ballotOpenFor,
  ballotPosition,
  ballotRivals,
  ballotTicket,
  BALLOT_WINDOWS,
  ballotWindow,
  ballotWindowAt,
  nextBallotWindow,
  ballotWins,
  bedHall,
  bedHallNamed,
  holdsBed,
  holdsBedIn,
  publicBallotOpen,
  raidFor,
  raidOn,
  restAdjust,
  sleeperIn,
} from "./admin/hostel";
export type { BedHall, Sleeper } from "./admin/hostel";
export { HANDOUT, HANDOUT_TEXT, addHandout, handoutClassStudy, handoutPrice, handoutTestMarks, holdsHandout, lovesHandouts, tryBuyHandout } from "./admin/handouts";
export type { HandoutOutcome, HandoutSource } from "./admin/handouts";
export {
  RESULT_PASS_MARK,
  RESULT_REMARK,
  RESULT_TEXT,
  carryOverCodes,
  carryOverSlots,
  recordResult,
  resultRemark,
  resultSlip,
  testCourseOn,
  testCoursesFor,
  timetableWithCarryOvers,
} from "./admin/results";
export type { ResultSlip, SlipRow } from "./admin/results";
export {
  BUSINESS_CENTRES,
  HOSTEL_PITCHES,
  HUSTLES,
  HUSTLE_LIMITS,
  HUSTLE_TEXT,
  TRAY_TRAFFIC,
  atBusinessCentre,
  finishHustle,
  hustlePay,
  hustleRefusal,
  hustleShiftsToday,
  hustleSite,
  nearestBusinessCentre,
  trayCustomers,
} from "./admin/hustles";
export type { HustleSpec } from "./admin/hustles";
export { parseAdminAction, parseAdminPayload } from "./admin/protocol";
export type { AdminAction, AdminPayload, AdminShift } from "./admin/protocol";
