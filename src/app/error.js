// src/app/error.js
// Shown when a page throws while rendering. Player can retry or log out.
"use client";
import ErrorScreen from "@/components/ErrorScreen";

export default function Error({ error, reset, unstable_retry }) {
  // Newer Next.js versions pass `unstable_retry` (refetch and re-render); older ones only pass `reset`.
  const retry = typeof unstable_retry === "function" ? unstable_retry : reset;
  return <ErrorScreen onRetry={retry} digest={error?.digest} />;
}