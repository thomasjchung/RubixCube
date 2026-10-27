/** Download the current camera frame (full resolution, unmirrored) as a PNG, for tuning the detector. */
export function saveFrame(video: HTMLVideoElement, label = "frame") {
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cube-${label}-${stamp}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}
