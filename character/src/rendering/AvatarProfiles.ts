export type AvatarStyle = "scan" | "procedural";
export function preferScannedAvatar(): boolean {
  return new URLSearchParams(window.location.search).get("avatar") !== "procedural";
}
