// src/app/admin/layout.js — every /admin page lives inside the administrator frame (see components/admin/Frame.js). The server decides nothing here:
// the frame asks the API who you are, and the API answers a plain 404 to anyone who is not an administrator.
import Frame from "@/components/admin/Frame";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };
export default function AdminLayout({ children }) { return <Frame>{children}</Frame>; }
