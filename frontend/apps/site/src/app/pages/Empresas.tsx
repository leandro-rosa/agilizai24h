import { Link } from "react-router";
import {
  Clock,
  TrendingUp,
  Users,
  Coffee,
  Zap,
  Star,
  CheckCircle2,
  ArrowRight,
  Timer,
  DollarSign,
  Heart,
  Package,
} from "lucide-react";
import heroImage from "@/assets/store-1.jpeg";

export function Empresas() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={heroImage}
            alt="Agiliz.ai para Empresas"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/95 via-zinc-950/85 to-zinc-950"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
          <div className="max-w-3xl">
            <div className="inline-block px-4 py-2 rounded-full bg-pink-500/20 border border-pink-500/30 text-pink-400 text-sm font-semibold mb-6">
              Solução para Empresas
            </div>
            <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
              Aumente a produtividade{" "}
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                sem parar o time
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              Um benefício real que economiza tempo, reduz pausas e mantém seu
              time focado. Mercado autônomo 24h dentro da sua empresa — comida
              de verdade, sem fila, sem operação.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to="/contato"
                className="group px-8 py-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold hover:shadow-2xl hover:shadow-pink-500/50 transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
              >
                Solicitar proposta
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="https://wa.me/5511947360963?text=Olá!%20Quero%20entender%20como%20posso%20instalar%20o%20Agiliz.ai%20na%20minha%20empresa%20ou%20condomínio.%20Pode%20me%20explicar%20os%20próximos%20passos?"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 rounded-xl bg-white/10 backdrop-blur-lg text-white font-semibold hover:bg-white/20 transition-all duration-300 border border-white/20"
              >
                Falar no WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Pain Points */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Problemas que você{" "}
              <span className="text-pink-500">já conhece</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Pequenas pausas que se acumulam e impactam a produtividade do seu
              time
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: <Timer className="w-8 h-8" />,
                title: "Tempo perdido",
                description:
                  "30-45min por dia saindo para almoçar ou lanchar",
              },
              {
                icon: <DollarSign className="w-8 h-8" />,
                title: "Custo alto",
                description: "Gastos elevados com alimentação fora da empresa",
              },
              {
                icon: <Users className="w-8 h-8" />,
                title: "Perda de foco",
                description: "Quebra de ritmo e dificuldade para retomar tarefas",
              },
              {
                icon: <Heart className="w-8 h-8" />,
                title: "Insatisfação",
                description: "Falta de opções práticas e saudáveis no local",
              },
            ].map((pain, index) => (
              <div
                key={index}
                className="p-6 rounded-xl bg-zinc-800 border border-zinc-700"
              >
                <div className="w-14 h-14 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 mb-4">
                  {pain.icon}
                </div>
                <h3 className="text-xl font-bold mb-2">{pain.title}</h3>
                <p className="text-gray-400">{pain.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solution */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                A solução está{" "}
                <span className="text-pink-500">dentro da empresa</span>
              </h2>
              <p className="text-xl text-gray-300 mb-8 leading-relaxed">
                Com o Agiliz.ai, seu time tem acesso a refeições completas,
                lanches e bebidas 24 horas por dia, sem sair do prédio.
              </p>
              <ul className="space-y-4">
                {[
                  "Zero tempo de deslocamento",
                  "Refeições prontas em segundos",
                  "Mantém o time produtivo e focado",
                  "Benefício real que faz diferença",
                  "Sem custo de implantação ou operação",
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-pink-500 flex-shrink-0 mt-0.5" />
                    <span className="text-lg text-gray-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-pink-500 to-purple-600 rounded-2xl blur-2xl opacity-20"></div>
              <div className="relative bg-gradient-to-br from-zinc-800 to-zinc-900 p-8 rounded-2xl border border-zinc-700">
                <div className="text-center">
                  <div className="text-6xl font-bold text-pink-500 mb-2">
                    45min
                  </div>
                  <p className="text-gray-400 mb-8">
                    economizados por dia, por colaborador
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-left">
                    <div className="p-4 bg-zinc-950 rounded-lg">
                      <div className="text-3xl font-bold text-purple-500 mb-1">
                        24/7
                      </div>
                      <p className="text-sm text-gray-400">
                        Sempre disponível
                      </p>
                    </div>
                    <div className="p-4 bg-zinc-950 rounded-lg">
                      <div className="text-3xl font-bold text-pink-500 mb-1">
                        R$ 0,00
                      </div>
                      <p className="text-sm text-gray-400">
                        Custo de setup
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Benefícios para <span className="text-pink-500">sua empresa</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: <TrendingUp className="w-10 h-10" />,
                title: "Aumento de Produtividade",
                description:
                  "Menos tempo perdido em pausas para alimentação",
                color: "pink",
              },
              {
                icon: <Users className="w-10 h-10" />,
                title: "Retenção de Talentos",
                description:
                  "Benefício diferenciado que valoriza seu colaborador",
                color: "purple",
              },
              {
                icon: <Star className="w-10 h-10" />,
                title: "Employer Branding",
                description: "Destaque-se como empresa inovadora e cuidadosa",
                color: "pink",
              },
              {
                icon: <Zap className="w-10 h-10" />,
                title: "Implementação Rápida",
                description: "Instalado sem obras ou adequações complexas",
                color: "purple",
              },
              {
                icon: <DollarSign className="w-10 h-10" />,
                title: "Baixo investimento",
                description: "Zero custo de implantação, com retorno garantido",
                color: "pink",
              },
              {
                icon: <Clock className="w-10 h-10" />,
                title: "Disponível 24/7",
                description: "Para equipes em todos os turnos",
                color: "purple",
              },
            ].map((benefit, index) => (
              <div
                key={index}
                className="group p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 hover:border-pink-500/50 transition-all duration-300 hover:scale-105"
              >
                <div
                  className={`w-16 h-16 rounded-xl bg-gradient-to-br ${
                    benefit.color === "pink"
                      ? "from-pink-500 to-pink-600"
                      : "from-purple-500 to-purple-600"
                  } flex items-center justify-center text-white mb-6 shadow-lg group-hover:shadow-pink-500/30 transition-shadow`}
                >
                  {benefit.icon}
                </div>
                <h3 className="text-2xl font-bold mb-3">{benefit.title}</h3>
                <p className="text-gray-400 leading-relaxed">
                  {benefit.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Food Differentiation */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Não é só snack, é{" "}
              <span className="text-pink-500">comida de verdade</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Diferente de outros mercados autônomos, oferecemos refeições
              completas e opções saudáveis
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: <Coffee className="w-8 h-8" />,
                title: "Marmitas prontas",
                items: [
                  "Almoço completo",
                  "Opções fit",
                  "Vegetarianas",
                  "Low carb",
                ],
              },
              {
                icon: <Package className="w-8 h-8" />,
                title: "Café da manhã",
                items: [
                  "Panquecas",
                  "Waffles",
                  "Iogurtes",
                  "Frutas frescas",
                ],
              },
              {
                icon: <Coffee className="w-8 h-8" />,
                title: "Lanches rápidos",
                items: [
                  "Sanduíches naturais",
                  "Wraps",
                  "Saladas",
                  "Snacks saudáveis",
                ],
              },
              {
                icon: <Package className="w-8 h-8" />,
                title: "Bebidas",
                items: [
                  "Sucos naturais",
                  "Água",
                  "Refrigerantes",
                  "Energéticos",
                ],
              },
            ].map((category, index) => (
              <div
                key={index}
                className="p-6 rounded-xl bg-zinc-800 border border-zinc-700 hover:border-pink-500/50 transition-all"
              >
                <div className="w-14 h-14 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 mb-4">
                  {category.icon}
                </div>
                <h3 className="text-xl font-bold mb-4">{category.title}</h3>
                <ul className="space-y-2">
                  {category.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-gray-400"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-pink-500"></div>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Easy Implementation */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Implementação{" "}
              <span className="text-pink-500">sem complicação</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Cuidamos de tudo para você
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Análise do espaço",
                description:
                  "Visitamos sua empresa e definimos o melhor local para instalação",
              },
              {
                step: "02",
                title: "Instalação rápida",
                description:
                  "Montamos o mercado completo com produtos e sistema de pagamento",
              },
              {
                step: "03",
                title: "Gestão completa",
                description:
                  "Reposição automática, manutenção e suporte contínuo",
              },
            ].map((step, index) => (
              <div key={index} className="text-center">
                <div className="text-6xl font-bold text-pink-500/20 mb-4">
                  {step.step}
                </div>
                <div className="p-6 rounded-xl bg-zinc-800 border border-zinc-700">
                  <h3 className="text-2xl font-bold mb-3">{step.title}</h3>
                  <p className="text-gray-400">{step.description}</p>
                </div>
                {index < 2 && (
                  <div className="hidden md:block">
                    <ArrowRight className="w-8 h-8 text-pink-500/30 mx-auto mt-8" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-gradient-to-br from-pink-500 to-purple-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptMCAxMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6bS0xMiAwYzMuMzE0IDAgNiAyLjY4NiA2IDZzLTIuNjg2IDYtNiA2LTYtMi42ODYtNi02IDIuNjg2LTYgNi02em0xMi0xMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii4wNSIvPjwvZz48L3N2Zz4=')] opacity-30"></div>

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Pronto para aumentar a produtividade do seu time?
          </h2>
          <p className="text-xl text-white/90 mb-12">
            Entre em contato e receba uma proposta personalizada para sua
            empresa
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://wa.me/5511947360963?text=Olá!%20Quero%20entender%20como%20posso%20instalar%20o%20Agiliz.ai%20na%20minha%20empresa%20ou%20condomínio.%20Pode%20me%20explicar%20os%20próximos%20passos?"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 rounded-xl bg-white text-pink-600 font-semibold hover:shadow-2xl hover:shadow-white/30 transition-all duration-300 hover:scale-105"
            >
              Falar no WhatsApp
            </a>
            <Link
              to="/contato"
              className="px-8 py-4 rounded-xl bg-white/10 backdrop-blur-lg text-white font-semibold hover:bg-white/20 transition-all duration-300 border border-white/30"
            >
              Solicitar proposta completa
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
