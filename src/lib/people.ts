// Presentation helpers for showing *who* owns a task.
//
// profiles only stores id / email / full_name, so display name, initials and
// organisation are all derived here rather than stored.

// Mid-dark hues only — avatar labels are always white, so every entry has to
// clear contrast on its own without a per-colour exception.
const AVATAR_COLORS = [
  "#5B6CB8", // indigo
  "#2E7D6B", // teal
  "#B8683A", // clay
  "#7A5AA8", // violet
  "#3D7AA8", // steel
  "#A85A7A", // plum
  "#5A7D3D", // olive
  "#B85A5A", // brick
];

// Stable per-user colour: the same person keeps their colour across pages and
// reloads, so the avatar becomes a recognisable token rather than decoration.
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Which JV partner someone belongs to. Useful on this project specifically:
// knowing a blocker sits with the Village rather than the contractor changes
// who chases it. Unknown domains get no label rather than a wrong guess.
const ORG_BY_DOMAIN: Record<string, string> = {
  "jacobbros.ca": "Jacob Bros",
  "anmore.ca": "Village of Anmore",
  "islengineering.com": "ISL",
  "isl-eng.com": "ISL",
};

export function orgFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? ORG_BY_DOMAIN[domain] ?? null : null;
}

export function displayName(fullName: string | null, email: string): string {
  return fullName?.trim() || email.split("@")[0];
}
