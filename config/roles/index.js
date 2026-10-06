// Register every role here. Adding a role = add its JSON file and one line.
import seniorVideoEditor from "./senior-video-editor.json";

export const roles = [seniorVideoEditor];

export function getRole(slug) {
  return roles.find((r) => r.slug === slug) || null;
}
