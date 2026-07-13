import SectionHeading, { Em } from "@/components/ui/SectionHeading";
import FeatureCard from "@/components/ui/FeatureCard";
import { CakeIcon, FlavorIcon, HeartIcon, PeopleIcon } from "@/components/ui/icons";

const FEATURES = [
  {
    icon: CakeIcon,
    title: "Diseños personalizados",
    description: "Creamos tortas únicas a tu medida.",
  },
  {
    icon: PeopleIcon,
    title: "Atención directa",
    description: "Comunicación cercana y personalizada contigo.",
  },
  {
    icon: FlavorIcon,
    title: "Sabores para elegir",
    description: "Opciones deliciosas para todos los gustos.",
  },
  {
    icon: HeartIcon,
    title: "Detalles hechos con dedicación",
    description: "Cuidamos cada detalle como si fuera para nuestra familia.",
  },
];

export default function ValueProposition() {
  return (
    <section className="border-t border-border-soft bg-cream py-16 sm:py-24">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-10 px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Por qué elegirnos"
          title={
            <>
              No hacemos una torta cualquiera. Creamos la torta de{" "}
              <Em>tu celebración</Em>.
            </>
          }
          description="Cuéntanos cómo imaginas ese momento y trabajaremos contigo para transformar tu idea en una torta personalizada, cuidando el sabor, el diseño y cada detalle."
        />

        <div className="grid w-full grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}
