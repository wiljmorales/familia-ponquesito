/**
 * Vista previa del mensaje al cliente. A propósito NO imita una
 * conversación de WhatsApp (sin burbujas ni verdes): es una tarjeta neutra
 * de la marca, para que nadie crea que está viendo un chat real.
 */
export default function QuotePreview({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="self-start rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-medium text-cocoa">
        Vista previa · No se enviará ningún mensaje
      </p>
      <div className="whitespace-pre-wrap rounded-2xl border border-border-soft bg-cream-light p-4 text-sm leading-relaxed text-cocoa">
        {message}
      </div>
    </div>
  );
}
