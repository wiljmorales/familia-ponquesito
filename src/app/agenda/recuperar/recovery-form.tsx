"use client";

import { useState, useTransition } from "react";
import { requestReservationLinkRecovery } from "@/lib/actions/recover-reservation";

export default function RecoveryForm() {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form className="mt-8 space-y-5" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(async () => {
        const result = await requestReservationLinkRecovery(data);
        setMessage(result.message);
      });
    }}>
      <label className="block text-sm font-semibold text-cocoa">Código de reserva
        <input className="mt-2 w-full rounded-xl border border-border-soft bg-white px-4 py-3" name="code" required maxLength={16} autoComplete="off" placeholder="FP-8-XXXX" />
      </label>
      <label className="block text-sm font-semibold text-cocoa">Correo de la solicitud
        <input className="mt-2 w-full rounded-xl border border-border-soft bg-white px-4 py-3" name="email" type="email" required maxLength={160} autoComplete="email" />
      </label>
      <button className="rounded-full bg-terracotta px-6 py-3 font-semibold text-white disabled:opacity-60" type="submit" disabled={pending}>
        {pending ? "Procesando…" : "Solicitar enlace"}
      </button>
      {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
    </form>
  );
}
