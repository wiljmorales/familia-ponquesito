import type { ComponentType } from "react";
import type { IconProps } from "@/components/ui/icons";

interface FeatureCardProps {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
}

export default function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border-soft bg-cream-light p-6 text-center transition-colors hover:border-terracotta/40">
      <span className="flex size-12 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
        <Icon className="size-6" />
      </span>
      <h3 className="font-serif text-lg text-cocoa">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
    </div>
  );
}
