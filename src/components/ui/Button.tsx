import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { HeartIcon } from "@/components/ui/icons";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: "primary" | "outline";
  withHeart?: boolean;
  loading?: boolean;
  href?: string;
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium font-sans transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-terracotta text-cream-light hover:bg-terracotta-dark",
  outline:
    "border border-terracotta text-terracotta-dark bg-transparent hover:bg-terracotta/10",
};

export default function Button({
  children,
  variant = "primary",
  withHeart = false,
  loading = false,
  href,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className ?? ""}`;

  const content = (
    <>
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      <span>{children}</span>
      {withHeart && !loading && <HeartIcon className="size-4" />}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button className={classes} disabled={loading || disabled} {...rest}>
      {content}
    </button>
  );
}
