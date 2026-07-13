"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, XCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import type { CakeDesignRequestValues } from "@/lib/validations/cake-design";
import { cakeDesignRequestSchema } from "@/lib/validations/cake-design";
import { minCelebrationDateString } from "@/lib/validations/cake-request";
import { submitCakeDesign } from "@/lib/actions/submit-cake-design";
import { WHATSAPP_URL } from "@/lib/constants/business";
import { buildWhatsappMessageUrl } from "@/lib/utils/whatsapp";
import type { CakeDesign } from "@/lib/cake-builder/types";

interface DesignRequestFormValues {
  customerName: string;
  whatsapp: string;
  email: string;
  eventDate: string;
  guestCount: string;
  zone: string;
  companyWebsite: string;
}

const DEFAULT_VALUES: DesignRequestFormValues = {
  customerName: "",
  whatsapp: "",
  email: "",
  eventDate: "",
  guestCount: "",
  zone: "",
  companyWebsite: "",
};

type SubmitStatus = "idle" | "success" | "error";

interface DesignRequestFormProps {
  design: CakeDesign;
  onRestart?: () => void;
}

export default function DesignRequestForm({ design, onRestart }: DesignRequestFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DesignRequestFormValues, unknown, CakeDesignRequestValues>({
    resolver: zodResolver(cakeDesignRequestSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [designCode, setDesignCode] = useState<string | null>(null);

  useEffect(() => {
    if (status === "idle") return;
    document.getElementById("design-request-status")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [status]);

  async function onSubmit(values: CakeDesignRequestValues) {
    if (isSubmitting) return;

    setStatus("idle");
    setStatusMessage("");

    const formData = new FormData();
    formData.set("customerName", values.customerName);
    formData.set("whatsapp", values.whatsapp);
    formData.set("email", values.email ?? "");
    formData.set("eventDate", values.eventDate);
    formData.set("guestCount", String(values.guestCount));
    formData.set("zone", values.zone);
    formData.set("companyWebsite", values.companyWebsite);
    formData.set("design", JSON.stringify(design));

    const result = await submitCakeDesign(formData);

    if (result.ok) {
      setStatus("success");
      setStatusMessage(result.message);
      setDesignCode(result.designCode ?? null);
    } else {
      setStatus("error");
      setStatusMessage(result.message);
      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          if (field in DEFAULT_VALUES) {
            setError(field as keyof DesignRequestFormValues, { message });
          }
        }
      }
    }
  }

  if (status === "success") {
    const whatsappHref =
      WHATSAPP_URL && designCode
        ? buildWhatsappMessageUrl(
            WHATSAPP_URL,
            `Hola, creé una torta en Familia Ponquesito. Mi código de diseño es ${designCode}.`,
          )
        : null;

    return (
      <div
        id="design-request-status"
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 rounded-3xl border border-border-soft bg-cream-light p-6 text-center sm:p-8"
      >
        <CheckCircle2 aria-hidden className="size-12 text-terracotta" />
        <h3 className="font-serif text-2xl text-cocoa">{statusMessage}</h3>
        {designCode && (
          <p className="text-sm text-text-secondary">
            Código de diseño:{" "}
            <span className="font-mono text-base font-semibold text-cocoa">
              {designCode}
            </span>
          </p>
        )}
        <p className="max-w-sm text-sm leading-relaxed text-text-secondary">
          El diseño sirve como referencia. Familia Ponquesito confirmará
          contigo los detalles, disponibilidad y precio final.
        </p>
        {whatsappHref && (
          <Button href={whatsappHref} withHeart className="mt-1">
            Continuar por WhatsApp
          </Button>
        )}
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="mt-1 text-xs text-text-secondary underline-offset-2 hover:underline"
          >
            Diseñar otra torta
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5 rounded-3xl border border-border-soft bg-cream-light p-5 sm:p-8"
    >
      {/* Honeypot: invisible para personas, visible para bots simples que
          rellenan todos los campos del formulario. */}
      <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="cake-design-company">No completar este campo</label>
        <input
          id="cake-design-company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("companyWebsite")}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <InputField
          label="Nombre"
          required
          placeholder="Tu nombre completo"
          autoComplete="name"
          error={errors.customerName?.message}
          {...register("customerName")}
        />
        <InputField
          label="WhatsApp"
          required
          type="tel"
          placeholder="0414 1234567"
          autoComplete="tel"
          hint="Con este número te contactaremos."
          error={errors.whatsapp?.message}
          {...register("whatsapp")}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <InputField
          label="Fecha del evento"
          required
          type="date"
          min={minCelebrationDateString()}
          error={errors.eventDate?.message}
          {...register("eventDate")}
        />
        <InputField
          label="Cantidad aproximada de personas"
          required
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="Ej. 20"
          error={errors.guestCount?.message}
          {...register("guestCount")}
        />
      </div>

      <InputField
        label="Zona de entrega o retiro"
        required
        placeholder="Ej. Este de Barquisimeto"
        error={errors.zone?.message}
        {...register("zone")}
      />

      <InputField
        label="Correo (opcional)"
        type="email"
        placeholder="tucorreo@ejemplo.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />

      {status === "error" && (
        <div
          id="design-request-status"
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="submit" withHeart loading={isSubmitting} disabled={isSubmitting}>
          Quiero mi cotización
        </Button>
        <p className="text-xs leading-relaxed text-text-secondary sm:max-w-xs">
          El diseño sirve como referencia. Familia Ponquesito confirmará
          contigo los detalles, disponibilidad y precio final.
        </p>
      </div>
    </form>
  );
}
