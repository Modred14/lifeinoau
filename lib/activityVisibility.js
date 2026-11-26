// lib/activityVisibility.js
// When a building's activities may be on screen: ONLY once the player has gone through its door. Standing near it, at its entrance, in the travel sheet
// or on the map card shows nothing about what can be done inside. The rule uses the real interior state, never a distance. Pure, so Node can test it.
import { hasInterior } from "../lib3d/interiors/registry.js";

/** May the map card / travel sheet (both are seen from OUTSIDE) list this place's activities and activity links? Only open-air places, which have no inside to enter. */
export const showsActivitiesOutside = (place) => !!place && !hasInterior(place.id, place.kind);

/** May the room mount its activity UI? `standby`: the room is only being built ahead of time while the player walks up. `leaving`: they are on their way out. */
export const showsRoomActivities = ({ standby = false, leaving = false } = {}) => !standby && !leaving;

/** What to do on arrival when something (the OAU Guide) asked for an activity and no chip was shown to pick it: the activity's `act`, or null. */
export const wantedAct = (activities, want) => (want ? activities?.find((a) => a.act === want || a.key === want)?.act ?? null : null);
