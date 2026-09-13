export default function ConnectPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="font-display text-5xl text-text-hi">Mooring</h1>
      <button
        type="button"
        className="rounded-full border border-amber/40 px-6 py-2 font-mono text-sm text-amber transition hover:bg-amber/10"
      >
        Connect
      </button>
    </main>
  );
}
