"use client";
import { use } from "react";
import PlayerDetail from "@/components/admin/PlayerDetail";
export default function Page({ params }) { const { ref } = use(params); return <PlayerDetail refId={decodeURIComponent(ref)} />; }
