import { HEALTH, ILLNESS_NAME, WATER, type Illness } from "@campuslife/shared";

export const UP_NEPA_FUN = 4;
export const SAID_LIMIT = 60;

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
const percent = (share: number) => `${Math.round(share * 100)}%`;

export const TEXT = {
  lightOut: "💡 NEPA don take light again.",
  upNepa: `🎉 Up NEPA! Light don come back. +${UP_NEPA_FUN} fun`,
  genOn: "🔌 Gen don start. Light dey for here.",
  putOnGen: "📺 Ah! Put on gen now. Everything pause till the gen starts.",
  darkStudy: "🕯️ No light. You dey read with torch and e slow. Half study till light comes.",
  jacking: (room: string, others: number, bonus: number) => `📚 Jacking at ${room} with ${others} others. Group reading gives ${percent(bonus)} extra, but e go tire you.`,
  streak: (nights: number) => `🌙 Night reading ${nights} in a row. Body no be firewood, sleep small.`,
  dryTaps: `🚱 No water for tap. Carry bucket go the standpipe outside. -${WATER.wakeDryFun} fun`,
  tapsBack: "🚿 Water don come back. You don baff.",
  fetching: (seconds: number) => `🪣 You dey fetch water. Stay there for ${seconds} seconds.`,
  fetched: "🪣 You fetch water, you baff. Fresh again.",
  noNeedWater: "🚰 You don baff already. Leave water for others.",
  sick: (illness: Illness) => `🤒 ${ILLNESS_NAME[illness]} don catch you. You go waka slow and tire fast. Rest for your bed, buy drugs from the chemist, or go the Campus clinic.`,
  restCure: "🛌 You rest well and the fever don go. You are fine again.",
  notSick: "You no sick. Go drink water.",
  chemistShut: `💊 Chemist don close. E dey open ${HEALTH.chemistOpens / 60}:00 to ${HEALTH.chemistCloses / 60}:00.`,
  chemistBroke: `💊 Drugs na ${naira(HEALTH.chemistPrice)}. Your cash no reach. The Campus clinic is free.`,
  chemistWait: "💊 The chemist dey count your drugs.",
  chemistDone: `💊 You buy drugs for ${naira(HEALTH.chemistPrice)}. You are fine again.`,
  clinicShut: `🏥 Campus clinic opens 0${HEALTH.clinicOpens / 60}:00 to ${HEALTH.clinicCloses / 60}:00. Rest for your bed or try the chemist.`,
  clinicNumber: (number: number, minutes: number) => `🎫 Campus clinic: you be number ${number}. About ${minutes} minutes. Stay close.`,
  clinicBreak: "🏥 Doctor is on break. The queue no dey move.",
  clinicDone: "🩺 Doctor don see you. Free drugs. You are fine again.",
  leftQueue: "You waka comot. Your number don pass.",
  leftTask: "You waka comot before e finish.",
  busy: "You dey do something already.",
  tooFar: "Move closer first.",
};
