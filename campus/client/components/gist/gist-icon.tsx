import type { GistKind } from "@campuslife/shared";
import type { IconType } from "react-icons";
import {
  PiBedDuotone,
  PiBookOpenDuotone,
  PiCalendarBlankDuotone,
  PiCheckSquareDuotone,
  PiClipboardTextDuotone,
  PiDropDuotone,
  PiFlagDuotone,
  PiForkKnifeDuotone,
  PiLightbulbDuotone,
  PiMegaphoneDuotone,
  PiMicrophoneStageDuotone,
  PiSoccerBallDuotone,
  PiTelevisionDuotone,
} from "react-icons/pi";

const ICONS: Record<GistKind, IconType> = {
  class: PiBookOpenDuotone,
  show: PiMicrophoneStageDuotone,
  match: PiTelevisionDuotone,
  sport: PiSoccerBallDuotone,
  election: PiCheckSquareDuotone,
  congress: PiMegaphoneDuotone,
  march: PiFlagDuotone,
  light: PiLightbulbDuotone,
  water: PiDropDuotone,
  portal: PiClipboardTextDuotone,
  hostel: PiBedDuotone,
  calendar: PiCalendarBlankDuotone,
  food: PiForkKnifeDuotone,
};

export function GistIcon({ kind }: { kind: GistKind }) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden="true" focusable="false" />;
}
