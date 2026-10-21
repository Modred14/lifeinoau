// src/app/not-found.js
// Shown for any address that is not a page (Next.js renders this for every 404).
import NotFound from "@/components/NotFound";

export const metadata = { title: "Page not found" };

export default function NotFoundPage() {
  return <NotFound />;
}