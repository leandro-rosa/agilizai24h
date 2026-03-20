import { Target, Users, Zap, Heart, TrendingUp, Globe } from "lucide-react";

export function Sobre() {
  return (
    <div className="min-h-screen pt-20">
      {/* Hero Section */}
      <section className="py-24 bg-gradient-to-b from-zinc-950 to-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-block px-4 py-2 rounded-full bg-pink-500/20 border border-pink-500/30 text-pink-400 text-sm font-semibold mb-6">
              Sobre nós
            </div>
            <h1 className="text-5xl md:text-6xl font-bold mb-6">
              Por que o{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                Agiliz.ai
              </span>{" "}
              existe
            </h1>
            <p className="text-xl text-gray-300 leading-relaxed">
              Acreditamos que a vida moderna não deve te obrigar a escolher entre
              conveniência e qualidade. Por isso criamos uma solução que entrega
              ambos — 24 horas por dia, sem complicação.
            </p>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white mb-6 shadow-lg shadow-pink-500/30">
                <Target className="w-12 h-12" />
              </div>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Nossa <span className="text-pink-500">Missão</span>
              </h2>
              <p className="text-xl text-gray-300 leading-relaxed mb-6">
                Transformar a forma como as pessoas acessam alimentação e
                produtos essenciais em seus ambientes de trabalho e moradia.
              </p>
              <p className="text-lg text-gray-400 leading-relaxed">
                Eliminamos filas, deslocamentos e tempo perdido, oferecendo uma
                experiência de compra autônoma, rápida e sempre disponível — com
                a diferença de entregar comida de verdade, não apenas snacks.
              </p>
            </div>
            <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 p-8 rounded-2xl border border-zinc-700">
              <div className="space-y-6">
                {[
                  {
                    icon: <Zap className="w-6 h-6" />,
                    text: "Rapidez sem abrir mão da qualidade",
                  },
                  {
                    icon: <Heart className="w-6 h-6" />,
                    text: "Cuidado com a saúde e bem-estar",
                  },
                  {
                    icon: <Users className="w-6 h-6" />,
                    text: "Acessível para todos, 24/7",
                  },
                  {
                    icon: <Globe className="w-6 h-6" />,
                    text: "Tecnologia a serviço das pessoas",
                  },
                ].map((item, index) => (
                  <div key={index} className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 flex-shrink-0">
                      {item.icon}
                    </div>
                    <span className="text-lg text-gray-300">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Nossos <span className="text-pink-500">Valores</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Princípios que guiam cada decisão
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <Zap className="w-10 h-10" />,
                title: "Agilidade",
                description:
                  "Sua vida não para. Aqui, nem a gente. Velocidade e eficiência em cada interação.",
              },
              {
                icon: <Heart className="w-10 h-10" />,
                title: "Qualidade",
                description:
                  "Comida de verdade, produtos selecionados. Não fazemos concessões quando se trata de qualidade.",
              },
              {
                icon: <Users className="w-10 h-10" />,
                title: "Simplicidade",
                description:
                  "É só pegar, pagar e seguir o dia. A tecnologia deve facilitar, não complicar.",
              },
              {
                icon: <TrendingUp className="w-10 h-10" />,
                title: "Inovação",
                description:
                  "Sempre buscando novas formas de melhorar a experiência de conveniência.",
              },
              {
                icon: <Globe className="w-10 h-10" />,
                title: "Acessibilidade",
                description:
                  "Disponível 24/7 para todos. Conveniência sem barreiras de horário ou localização.",
              },
              {
                icon: <Target className="w-10 h-10" />,
                title: "Foco no cliente",
                description:
                  "Cada decisão pensada para melhorar sua rotina e economizar seu tempo.",
              },
            ].map((value, index) => (
              <div
                key={index}
                className="group p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 hover:border-pink-500/50 transition-all duration-300 hover:scale-105"
              >
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white mb-6 shadow-lg group-hover:shadow-pink-500/30 transition-shadow">
                  {value.icon}
                </div>
                <h3 className="text-2xl font-bold mb-4">{value.title}</h3>
                <p className="text-gray-400 leading-relaxed">
                  {value.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vision */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-pink-500 to-purple-600 rounded-3xl p-12 md:p-16 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptMCAxMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6bS0xMiAwYzMuMzE0IDAgNiAyLjY4NiA2IDZzLTIuNjg2IDYtNiA2LTYtMi42ODYtNi02IDIuNjg2LTYgNi02em0xMi0xMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii4wNSIvPjwvZz48L3N2Zz4=')] opacity-30"></div>
            
            <div className="relative z-10">
              <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-lg flex items-center justify-center text-white mx-auto mb-6 shadow-lg">
                <TrendingUp className="w-12 h-12" />
              </div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                Nossa Visão
              </h2>
              <p className="text-xl md:text-2xl text-white/90 max-w-3xl mx-auto leading-relaxed">
                Ser a referência em conveniência autônoma no Brasil,
                transformando cada empresa e condomínio em um espaço onde tempo
                é respeitado e qualidade nunca é negociada.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Modern Lifestyle */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-4xl md:text-5xl font-bold mb-8">
              Feito para o{" "}
              <span className="text-pink-500">estilo de vida moderno</span>
            </h2>
            <div className="space-y-6 text-lg text-gray-300 leading-relaxed">
              <p>
                Vivemos em um mundo onde cada minuto conta. Onde produtividade e
                bem-estar precisam andar juntos. Onde esperar em fila ou sair
                para almoçar pode significar perder o ritmo do dia.
              </p>
              <p>
                O Agiliz.ai nasceu dessa realidade. Uma solução que entende que{" "}
                <strong className="text-pink-500">
                  sua vida não para — e aqui, nem a gente
                </strong>
                .
              </p>
              <p>
                Combinamos tecnologia de ponta com um portfólio cuidadosamente
                selecionado de produtos — desde refeições completas até itens
                essenciais do dia a dia — para entregar uma experiência de
                conveniência sem precedentes.
              </p>
              <p className="text-xl text-pink-400 font-semibold">
                É só pegar, pagar e seguir o dia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Vamos transformar seu espaço?
          </h2>
          <p className="text-xl text-gray-400 mb-12">
            Entre em contato e descubra como levar o Agiliz.ai para sua empresa
            ou condomínio
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://wa.me/5511947360963?text=Olá!%20Quero%20entender%20como%20posso%20instalar%20o%20Agiliz.ai%20na%20minha%20empresa%20ou%20condomínio.%20Pode%20me%20explicar%20os%20próximos%20passos?"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold hover:shadow-2xl hover:shadow-pink-500/50 transition-all duration-300 hover:scale-105"
            >
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
