import Image from "next/image";

export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6">
        <div className="flex items-center gap-6">
          <Image
            src="/logo-jb.png"
            alt="Jacob Bros Construction"
            width={90}
            height={36}
            className="object-contain opacity-90"
          />
          <span className="text-zinc-300 text-lg">·</span>
          <Image
            src="/logo-anmore.png"
            alt="Village of Anmore"
            width={40}
            height={40}
            className="object-contain opacity-90"
          />
          <span className="text-zinc-300 text-lg">·</span>
          <Image
            src="/logo-isl.webp"
            alt="ISL Engineering"
            width={54}
            height={36}
            className="object-contain opacity-90"
          />
        </div>
        <p className="text-[11px] text-zinc-400">
          Anmore Operations Yard — Jacob Bros Construction, Village of Anmore &amp; ISL Engineering
        </p>
      </div>
    </footer>
  );
}
