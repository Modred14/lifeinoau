import { redirect } from "next/navigation";
// The apps live inside the phone now. Old links land on the game with the app open.
export default function Page() { redirect("/play?app=achievements"); }