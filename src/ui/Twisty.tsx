import { useEffect, useRef } from "react";

interface Props {
  setup: string;
  alg: string;
}

/** 3D animated cube (cubing.js), loaded lazily. */
export function Twisty({ setup, alg }: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let el: HTMLElement | null = null;
    import("cubing/twisty").then(({ TwistyPlayer }) => {
      if (cancelled || !host.current) return;
      el = new TwistyPlayer({
        puzzle: "3x3x3",
        experimentalSetupAlg: setup,
        alg,
        background: "none",
        controlPanel: "bottom-row",
        hintFacelets: "floating",
        viewerLink: "none",
        tempoScale: 1.5,
      });
      el.style.width = "100%";
      el.style.height = "260px";
      host.current.appendChild(el);
    });
    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [setup, alg]);
  return <div className="twisty" ref={host} />;
}
