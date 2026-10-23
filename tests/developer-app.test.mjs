// tests/developer-app.test.mjs: the Developer phone app. Pure Node: reads the data module and the source files.
import fs from "node:fs";
import { DEVELOPER, SKILLS, FEATURED, PROJECTS, messageErrorText } from "../lib/developer.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK   " : "FAIL ") + l); };
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("components/apps/DeveloperApp.js"), phone = read("components/Phone.js"), icon = read("components/Icon.js"), css = read("components/apps/developer-app.css");

chk("public details are exactly the ones listed", DEVELOPER.name === "Favour Omirin" && DEVELOPER.nickname === "Modred" && DEVELOPER.username === "modred" && DEVELOPER.role === "Software Engineer · Full-Stack Developer" && DEVELOPER.portfolio === "https://modred.dev" && DEVELOPER.email === "favourdomirin@gmail.com");
chk("no other contact fields are exposed", Object.keys(DEVELOPER).sort().join() === "bio,email,name,nickname,portfolio,role,username");
chk("bio mentions OAU, Software Engineering and a playable 3D world", /Obafemi Awolowo University \(OAU\)/.test(DEVELOPER.bio.join(" ")) && /Software Engineering student/.test(DEVELOPER.bio.join(" ")) && /playable 3D virtual world/.test(DEVELOPER.bio.join(" ")));
chk("skills include the required technologies", ["JavaScript", "React", "Next.js", "Node.js", "PostgreSQL"].every((s) => SKILLS.includes(s)));
chk("Life in OAU is featured, plus 2-3 modred.dev projects with https links", FEATURED.name === "Life in OAU" && PROJECTS.length >= 2 && PROJECTS.length <= 3 && PROJECTS.every((p) => p.href.startsWith("https://")));
chk("404 shows a clear 'not found' message", /could not be found/.test(messageErrorText({ status: 404, error: "No player with that name." })));
chk("other errors show the server's own message", messageErrorText({ status: 400, error: "You cannot message yourself." }) === "You cannot message yourself.");
chk("a failure with no message still says something", messageErrorText({ failed: true }).length > 10);

chk("portfolio link is a real new-tab link", /href=\{DEVELOPER\.portfolio\} target="_blank" rel="noopener noreferrer"/.test(app));
chk("email link is a mailto link", /href=\{`mailto:\$\{DEVELOPER\.email\}`\}/.test(app));
chk("Message button asks the real messages API (no second chat system)", /call\("\/api\/messages\?with=" \+ encodeURIComponent\(DEVELOPER\.username\)\)/.test(app) && !/\/api\/messages",/.test(app) && !/chat\.send/.test(app));
chk("it opens Messages only after the lookup succeeds, with the server's name", /if \(r\.failed \|\| !r\.with\) return setError/.test(app) && /onOpenApp\?\.\("messages", r\.with\)/.test(app));
chk("a 401 sends the player to log in", /r\.status === 401\) return loggedOut\(router\)/.test(app));
chk("the error is announced to screen readers", /role="alert"/.test(app));

chk("Phone registers the app and puts it in the launcher", /developer: \{ name: "Developer"/.test(phone) && /"guide", "developer", "settings"/.test(phone));
chk("Phone passes the player name to Messages and still resets it", /initialWho=\{app === "messages" \? \(peer \?\? initialWith\) : null\}/.test(phone) && /setPeer\(null\)/.test(phone));
chk("every app still gets the shared openApp", !/onOpenApp=\{setApp\}/.test(phone));
chk("the code icon exists", /code: Code/.test(icon));
chk("dark theme and tile are defined", /data-app="developer"/.test(css) && /data-tone="dev"/.test(css));
chk("motion respects reduced-motion", /prefers-reduced-motion: reduce/.test(css));
process.exit(bad ? 1 : 0);
