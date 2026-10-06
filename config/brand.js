// Brand + company settings. To replicate this platform for a client, change
// this file, drop their logos in public/assets, and add their roles in
// config/roles. Nothing else needs to change.
export const brand = {
  company: "Peak Exposure Media",
  shortName: "PEM",
  tagline: "Great brands deserve to be seen.",
  website: "https://peakexposuremedia.com",
  careersUrl: "https://careers.peakexposuremedia.com",
  // Where "reply to everyone within 24 hours" emails come from (used when
  // RESEND_API_KEY is configured; otherwise shown as a contact address).
  fromEmail: "cameron@peakexposuremedia.com",
  fromName: "Cameron Monahan, Peak Exposure Media",
  // Public assets served from /assets
  logoLight: "/assets/pem-logo-white.png",
  logoGold: "/assets/pem-logo-gold.png",
  icon: "/assets/pem-icon-gold.png",
  // Palette + type. The front end reads these as CSS variables.
  colors: {
    navyDeep: "#1B1F28",
    navy: "#2D3340",
    navySoft: "#3A4152",
    gold: "#D4BC85",
    goldLight: "#E6D7B2",
    white: "#FFFFFF",
    muted: "#A6ACBB",
    muted2: "#7C8296",
  },
  fonts: {
    display: "'Bebas Neue', sans-serif",
    body: "'Montserrat', sans-serif",
    googleFontsHref:
      "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@400;500;600;700&display=swap",
  },
};
