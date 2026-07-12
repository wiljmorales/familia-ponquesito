import type { Metadata } from "next";
import { Inter, Playfair_Display, Sacramento } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const sacramento = Sacramento({
  variable: "--font-sacramento",
  subsets: ["latin"],
  weight: "400",
});

const SITE_URL = "https://familia-ponquesito.vercel.app";
const TITLE = "Tortas personalizadas en Barquisimeto | Familia Ponquesito";
const DESCRIPTION =
  "Tortas personalizadas para cumpleaños y celebraciones en Barquisimeto. Diseños hechos con amor, sabores para elegir y atención personalizada.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Familia Ponquesito",
    locale: "es_VE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${playfair.variable} ${inter.variable} ${sacramento.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: extensiones como Grammarly inyectan
          atributos en <body> y disparan falsos avisos de hidratación */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
