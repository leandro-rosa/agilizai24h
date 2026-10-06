import type { PageIntro } from "@/lib/overview/brief";

/** Faixa de abertura de cada bloco: a pergunta, a resposta em uma frase e quem costuma olhar. */
export function IntroStrip({ intro }: { intro: PageIntro }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-primary pl-3">
      <p className="text-xs font-semibold text-muted-foreground">
        {intro.question} <span className="font-normal">· para {intro.audience.join(" e ")}</span>
      </p>
      <p className="text-base font-medium">{intro.answer}</p>
    </div>
  );
}
