import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/sections/Hero";
import Gallery from "@/components/sections/Gallery";
import ValueProposition from "@/components/sections/ValueProposition";
import HowItWorks from "@/components/sections/HowItWorks";
import Flavors from "@/components/sections/Flavors";
import Conditions from "@/components/sections/Conditions";
import RequestForm from "@/components/sections/RequestForm";
import ClosingSection from "@/components/sections/ClosingSection";
import { INSTAGRAM_URL, LOCATION_LABEL } from "@/lib/constants/business";

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "Bakery",
  name: "Familia Ponquesito",
  description:
    "Tortas personalizadas para cumpleaños y celebraciones en Barquisimeto, Venezuela.",
  areaServed: LOCATION_LABEL,
  sameAs: [INSTAGRAM_URL],
  slogan: "Hecho con amor, para compartir.",
};

export default function Home() {
  return (
    <>
      {/* Datos propios y estáticos del negocio (sin entrada de usuario). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <Header />
      <main>
        <Hero />
        <Gallery />
        <ValueProposition />
        <section
          id="como-funciona"
          className="scroll-mt-24 border-t border-border-soft bg-cream-light py-16 sm:py-24"
        >
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:divide-x lg:divide-border-soft lg:px-8">
            <div className="lg:pr-10">
              <HowItWorks />
            </div>
            <div className="lg:pl-10">
              <Flavors />
            </div>
          </div>
        </section>
        <Conditions />
        <RequestForm />
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
