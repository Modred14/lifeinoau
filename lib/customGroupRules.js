// lib/customGroupRules.js
// The rules of player-made groups as pure functions: names, roles and who may do what. No database, so the screen and Node tests use the same code.
// The server (lib/customGroupService.js) is what enforces them.
import { cleanText } from "./rules.js";
import { FACULTIES } from "./faculties.js";
import { groupName } from "./facultyGroupRules.js";

export const LIMITS = {
  nameMin: 3, nameMax: 40, descMax: 200,
  ownedPerPlayer: 5, // groups one player may own at a time
  joinedPerPlayer: 50, // groups one player may be in at a time
  membersPerGroup: 500,
  pendingPerGroup: 200, // invitations waiting for an answer
  page: 30,
};
export const PRIVACY = ["PUBLIC", "PRIVATE"];
export const ROLES = ["OWNER", "ADMIN", "MEMBER"];

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const OFFICIAL = new Set(FACULTIES.flatMap(([f]) => [squash(f), squash(groupName(f))]));

/** { name } or { error }. A custom group may not pass itself off as an official one. */
export function checkName(raw) {
  const name = cleanText(raw, 200).replace(/\s+/g, " ");
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) return { error: `A group name has ${LIMITS.nameMin} to ${LIMITS.nameMax} characters.` };
  if (!/^[A-Za-z0-9 &'().,!_-]+$/.test(name) || !/[A-Za-z0-9]/.test(name)) return { error: "Use letters, numbers, spaces and simple punctuation in a group name." };
  const k = squash(name);
  if (OFFICIAL.has(k) || k.includes("facultygroup") || k.includes("official")) return { error: "That name is kept for official groups. Choose another." };
  return { name };
}
export const cleanDescription = (raw) => cleanText(raw, LIMITS.descMax).replace(/\s+/g, " ");

const manages = (role) => role === "OWNER" || role === "ADMIN";
/** What a role may do in its group. `null` (not a member) may do none of it. */
export function permissions(role) {
  return {
    edit: manages(role), // name and description
    invite: manages(role), // invite, approve or reject requests, cancel invitations
    changePrivacy: role === "OWNER",
    changeRoles: role === "OWNER",
    transfer: role === "OWNER",
    destroy: role === "OWNER",
    leave: !!role,
  };
}
/** May `actor` remove a member who has `target` role? The owner removes anyone else; an administrator removes regular members only. */
export const mayRemove = (actor, target) => (actor === "OWNER" && target !== "OWNER") || (actor === "ADMIN" && target === "MEMBER");
