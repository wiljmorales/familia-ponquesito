"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, XCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import InputField from "@/components/ui/InputField";
import SelectField from "@/components/ui/SelectField";
import TextareaField from "@/components/ui/TextareaField";
import FileField from "@/components/ui/FileField";
import type { CakeRequestValues } from "@/lib/validations/cake-request";
import { cakeRequestSchema, minCelebrationDateString } from "@/lib/validations/cake-request";
import { submitCakeRequest } from "@/lib/actions/submit-cake-request";
import {
  CELEBRATION_TYPES,
  FORM_FLAVOR_OPTIONS,
  MAX_GUEST_COUNT,
} from "@/lib/constants/business";

interface RequestFormValues {
  customerName: string;
  whatsapp: string;
  email: string;
  celebrationDate: string;
  celebrationType: string;
  guestCount: string;
  preferredFlavor: string;
  cakeDescription: string;
  companyWebsite: string;
}

const DEFAULT_VALUES: RequestFormValues = {
  customerName: "",
  whatsapp: "",
  email: "",
  celebrationDate: "",
  celebrationType: "",
  guestCount: "",
  preferredFlavor: "",
  cakeDescription: "",
  companyWebsite: "",
};

type SubmitStatus = "idle" | "success" | "error";

const MAX_IMAGE_MB = 5;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function RequestForm() {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<RequestFormValues, unknown, CakeRequestValues>({
    resolver: zodResolver(cakeRequestSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | undefined>();
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  useEffect(() => {
    if (status === "idle") return;
    document
      .getElementById("request-status")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [status]);

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImageError(undefined);

    if (!file) {
      setImageFile(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError("Solo se aceptan imágenes JPG, PNG o WebP.");
      setImageFile(null);
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setImageError(`La imagen supera el máximo de ${MAX_IMAGE_MB} MB.`);
      setImageFile(null);
      event.target.value = "";
      return;
    }

    setImageFile(file);
  }

  async function onSubmit(values: CakeRequestValues) {
    if (isSubmitting) return;

    setStatus("idle");
    setStatusMessage("");

    const formData = new FormData();
    formData.set("customerName", values.customerName);
    formData.set("whatsapp", values.whatsapp);
    formData.set("email", values.email);
    formData.set("celebrationDate", values.celebrationDate);
    formData.set("celebrationType", values.celebrationType);
    formData.set("guestCount", String(values.guestCount));
    formData.set("preferredFlavor", values.preferredFlavor);
    formData.set("cakeDescription", values.cakeDescription);
    formData.set("companyWebsite", values.companyWebsite);
    if (imageFile) formData.set("referenceImage", imageFile);

    const result = await submitCakeRequest(formData);

    if (result.ok) {
      setStatus("success");
      setStatusMessage(result.message);
      reset(DEFAULT_VALUES);
      setImageFile(null);
      clearErrors();
    } else {
      setStatus("error");
      setStatusMessage(result.message);
      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          if (field === "referenceImage") {
            setImageError(message);
          } else if (field in DEFAULT_VALUES) {
            setError(field as keyof RequestFormValues, { message });
          }
        }
      }
    }
  }

  return (
    <section id="formulario" className="scroll-mt-24 bg-cream py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,320px)_1fr] lg:gap-16 lg:px-8">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
            Hablemos de tu celebración
          </p>
          <h2 className="font-serif text-3xl leading-tight text-cocoa sm:text-4xl">
            Cuéntanos cómo imaginas tu <em className="font-serif italic text-terracotta">celebración</em>.
          </h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Completa los datos y te contactaremos para confirmar
            disponibilidad y preparar tu cotización.
          </p>
        </div>

        <div className="rounded-3xl border border-border-soft bg-cream-light p-5 sm:p-8">
          {status === "success" ? (
            <div
              id="request-status"
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-3 py-8 text-center"
            >
              <CheckCircle2 aria-hidden className="size-12 text-terracotta" />
              <h3 className="font-serif text-2xl text-cocoa">¡Recibimos tu solicitud!</h3>
              <p className="max-w-md text-sm leading-relaxed text-text-secondary">
                Revisaremos los detalles y te contactaremos por WhatsApp para
                confirmar disponibilidad y preparar tu cotización.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStatus("idle")}
              >
                Enviar otra solicitud
              </Button>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={handleSubmit(onSubmit)}
              className="flex flex-col gap-5"
            >
              {/* Honeypot: invisible para personas, visible para bots simples que
                  rellenan todos los campos del formulario. */}
              <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor="companyWebsite">No completar este campo</label>
                <input
                  id="companyWebsite"
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

              <InputField
                label="Correo"
                required
                type="email"
                placeholder="tucorreo@ejemplo.com"
                autoComplete="email"
                hint="Te enviaremos la confirmación de tu solicitud aquí."
                error={errors.email?.message}
                {...register("email")}
              />

              <div className="grid gap-5 sm:grid-cols-3">
                <InputField
                  label="Fecha de la celebración"
                  required
                  type="date"
                  min={minCelebrationDateString()}
                  error={errors.celebrationDate?.message}
                  {...register("celebrationDate")}
                />
                <SelectField
                  label="Tipo de celebración"
                  required
                  placeholder="Selecciona una opción"
                  options={CELEBRATION_TYPES}
                  error={errors.celebrationType?.message}
                  {...register("celebrationType")}
                />
                <InputField
                  label="Número aproximado de personas"
                  required
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_GUEST_COUNT}
                  placeholder="Ej. 20"
                  error={errors.guestCount?.message}
                  {...register("guestCount")}
                />
              </div>

              <SelectField
                label="Sabor preferido"
                required
                placeholder="Selecciona un sabor"
                options={FORM_FLAVOR_OPTIONS}
                error={errors.preferredFlavor?.message}
                {...register("preferredFlavor")}
              />

              <TextareaField
                label="Idea o descripción de la torta"
                required
                placeholder="Cuéntanos el estilo, colores, dedicatoria o cualquier detalle que imagines para tu torta."
                hint="Mínimo 10 caracteres."
                error={errors.cakeDescription?.message}
                {...register("cakeDescription")}
              />

              <FileField
                label="Referencia visual opcional"
                name="referenceImage"
                accept="image/jpeg,image/png,image/webp"
                hint={`JPG, PNG o WebP. Máximo ${MAX_IMAGE_MB} MB.`}
                error={imageError}
                onChange={handleImageChange}
              />

              {status === "error" && (
                <div
                  id="request-status"
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{statusMessage}</span>
                </div>
              )}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <Button type="submit" withHeart loading={isSubmitting} disabled={isSubmitting}>
                  Enviar mi solicitud
                </Button>
                <p className="text-xs leading-relaxed text-text-secondary sm:max-w-xs">
                  Al enviar tus datos aceptas que Familia Ponquesito te
                  contacte para responder tu solicitud.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
