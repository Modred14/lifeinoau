import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, type PasswordProblem, type UsernameProblem } from "@campuslife/shared/account";

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters.`;

export const USERNAME_PROBLEMS: Record<UsernameProblem, string> = {
  short: `Your username needs at least ${USERNAME_MIN_LENGTH} characters.`,
  long: `Your username can be at most ${USERNAME_MAX_LENGTH} characters.`,
  characters: "Use only letters, numbers and underscores in your username.",
  reserved: "That username isn't available. Try another one.",
};

export const PASSWORD_PROBLEMS: Record<PasswordProblem, string> = {
  short: `Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`,
  long: `Your password can be at most ${PASSWORD_MAX_LENGTH} characters.`,
  username: "Your password can't contain your username.",
};
