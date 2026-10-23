export default function manifest() {
  return { id: "/", name: "OAU Life", short_name: "OAU Life", description: "Live your student life on the OAU campus.", start_url: "/home", scope: "/", display: "standalone", orientation: "any", lang: "en-NG", dir: "ltr", categories: ["games", "education", "social"], prefer_related_applications: false, background_color: "#0d1321", theme_color: "#15803d", icons: [{ src: "/app-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/app-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
