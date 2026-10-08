"use client";

import dynamic from "next/dynamic";

const RenderClient = dynamic(() => import("./RenderClient"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 text-[11px] text-neutral-400">
      Loading the renderer…
    </div>
  ),
});

export default function RenderPage() {
  return <RenderClient />;
}
