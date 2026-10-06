// Register every role here. Adding a role = add its JSON file and one line.
import seniorVideoEditor from "./senior-video-editor.json";
import socialMediaSpecialist from "./social-media-specialist.json";

export const roles = [seniorVideoEditor, socialMediaSpecialist];

export function getRole(slug) {
  return roles.find((r) => r.slug === slug) || null;
}
