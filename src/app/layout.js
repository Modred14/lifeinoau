// app/layout.js
import "./globals.css";
export const metadata = {
  title: "OAU Life",
  description: "Your life. Your choices. Your OAU.",
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
