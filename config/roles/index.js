// Register every role here. Adding a role = add its JSON file and one line.
import seniorVideoEditor from "./senior-video-editor.json";
import socialMediaSpecialist from "./social-media-specialist.json";
import socialMediaIntern from "./social-media-intern.json";
import videoEditorIntern from "./video-editor-intern.json";
import videographyIntern from "./videography-intern.json";

export const roles = [seniorVideoEditor, socialMediaSpecialist, socialMediaIntern, videoEditorIntern, videographyIntern];

export function getRole(slug) {
  return roles.find((r) => r.slug === slug) || null;
}
