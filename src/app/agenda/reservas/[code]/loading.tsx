export default function ReservationLoading() {
  return (
    <main
      className="flex min-h-full flex-1 items-center justify-center bg-cream px-4 py-16"
      aria-busy="true"
    >
      <p className="animate-pulse font-serif text-xl text-cocoa">Consultando tu reserva…</p>
    </main>
  );
}
