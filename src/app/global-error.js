// src/app/global-error.js
// Last line of defence: shown when the root layout itself throws (it replaces the layout, so it needs its own <html>).
"use client";
import "./globals.css";
import ErrorScreen from "@/components/ErrorScreen";

export default function GlobalError({ error, reset, unstable_retry }) {
  const retry = typeof unstable_retry === "function" ? unstable_retry : reset;
  return (
    <html lang="en">
      <body>
        <ErrorScreen onRetry={retry} digest={error?.digest} />
      </body>
    </html>
  );
}