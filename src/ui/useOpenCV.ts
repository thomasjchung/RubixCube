import { useEffect, useState } from "react";
import { loadOpenCV } from "../vision/stickers";

/** Loads OpenCV.js once; returns the module (wrapped) when ready, or an error message. */
export function useOpenCV() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cv, setCv] = useState<{ cv: any } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadOpenCV().then(setCv, (e) => setError(String(e?.message ?? e)));
  }, []);
  return { cv: cv?.cv ?? null, error };
}
