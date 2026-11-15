"use client";

import { useEffect, useState } from "react";
import Terminal from "../components/Terminal";

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-screen w-screen bg-[var(--bg)]" />;
  }

  return <Terminal />;
}
