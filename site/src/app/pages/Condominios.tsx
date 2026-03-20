import { Link } from "react-router";
import {
  Building2,
  Clock,
  Star,
  Shield,
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  Package,
  Heart,
  Zap,
  Users,
} from "lucide-react";
import storeImage from "@/assets/store-2.jpeg";

export function Condominios() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={storeImage}
            alt="Agiliz.ai para Condomínios"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/95 via-zinc-950/85 to-zinc-950"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
          <div className="max-w-3xl">
            <div className="inline-block px-4 py-2 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 text-sm font-semibold mb-6">
              Solução para Condomínios
            </div>
            <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
              Conveniência que{" "}
              <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                valoriza seu condomínio
              </span>
            </h1>
            <p className="text-xl text-gray-300 mb-8 leading-relaxed">
              Um mercado autônomo 24h que oferece praticidade aos moradores,
              aumenta o valor do imóvel e não gera custos ou trabalho para a
              administração.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to="/contato"
                className="group px-8 py-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 text-white font-semibold hover:shadow-2xl hover:shadow-purple-500/50 transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
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

      {/* Pain Points for Síndicos */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Desafios do <span className="text-purple-500">síndico</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Entendemos os desafios de oferecer mais conveniência sem aumentar
              custos ou responsabilidades
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <Users className="w-8 h-8" />,
                title: "Reclamações de moradores",
                description:
                  "Falta de opções de conveniência próximas ao prédio",
              },
              {
                icon: <Package className="w-8 h-8" />,
                title: "Custo operacional",
                description:
                  "Dificuldade em oferecer serviços sem aumentar taxa de condomínio",
              },
              {
                icon: <Shield className="w-8 h-8" />,
                title: "Gestão adicional",
                description: "Evitar novos contratos e responsabilidades",
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
            <div className="order-2 lg:order-1">
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-r from-purple-500 to-pink-600 rounded-2xl blur-2xl opacity-20"></div>
                <img
                  src={storeImage}
                  alt="Agiliz.ai no Condomínio"
                  className="relative rounded-2xl shadow-2xl"
                />
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                A solução{" "}
                <span className="text-purple-500">perfeita para você</span>
              </h2>
              <p className="text-xl text-gray-300 mb-8 leading-relaxed">
                Um mercado autônomo 24h instalado no seu condomínio. Moradores
                felizes, síndico tranquilo.
              </p>
              <ul className="space-y-4">
                {[
                  "Zero custo para o condomínio",
                  "Sem gestão ou manutenção necessária",
                  "Instalação rápida sem obras",
                  "Valorização do imóvel",
                  "Diferencial competitivo",
                  "Moradores mais satisfeitos",
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-purple-500 flex-shrink-0 mt-0.5" />
                    <span className="text-lg text-gray-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits for Residents */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Benefícios para{" "}
              <span className="text-purple-500">os moradores</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Conveniência que todos vão adorar
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: <Clock className="w-10 h-10" />,
                title: "Disponível 24/7",
                description:
                  "Compras a qualquer hora, sem precisar sair do prédio",
                color: "purple",
              },
              {
                icon: <Package className="w-10 h-10" />,
                title: "Comida de verdade",
                description: "Marmitas, lanches saudáveis e refeições prontas",
                color: "pink",
              },
              {
                icon: <Zap className="w-10 h-10" />,
                title: "Super rápido",
                description: "Pega, paga e volta pra casa em segundos",
                color: "purple",
              },
              {
                icon: <Shield className="w-10 h-10" />,
                title: "Seguro e prático",
                description: "Pagamento automático por Pix, cartão ou app",
                color: "pink",
              },
              {
                icon: <Heart className="w-10 h-10" />,
                title: "Família toda",
                description: "Opções para adultos, crianças e idosos",
                color: "purple",
              },
              {
                icon: <Star className="w-10 h-10" />,
                title: "Produtos variados",
                description: "Desde refeições até itens essenciais do dia a dia",
                color: "pink",
              },
            ].map((benefit, index) => (
              <div
                key={index}
                className="group p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 hover:border-purple-500/50 transition-all duration-300 hover:scale-105"
              >
                <div
                  className={`w-16 h-16 rounded-xl bg-gradient-to-br ${
                    benefit.color === "purple"
                      ? "from-purple-500 to-purple-600"
                      : "from-pink-500 to-pink-600"
                  } flex items-center justify-center text-white mb-6 shadow-lg group-hover:shadow-purple-500/30 transition-shadow`}
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

      {/* Benefits for Syndicate */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Por que é perfeito para{" "}
              <span className="text-purple-500">o condomínio</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white mb-6 shadow-lg">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-green-400">
                Zero investimento
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed mb-4">
                Instalação, equipamentos e produtos são 100% por nossa conta. O
                condomínio não gasta nada.
              </p>
              <ul className="space-y-2">
                {[
                  "Sem taxa de instalação",
                  "Sem custo de manutenção",
                  "Sem obras ou adequações complexas",
                  "Sem responsabilidade operacional",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white mb-6 shadow-lg">
                <TrendingUp className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-purple-400">
                Valorização do imóvel
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed mb-4">
                Um diferencial moderno que torna seu condomínio mais atrativo e
                valorizado.
              </p>
              <ul className="space-y-2">
                {[
                  "Aumento do valor de mercado",
                  "Diferencial em anúncios",
                  "Moradores mais satisfeitos",
                  "Inovação e modernidade",
                ].map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-gray-400"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center text-white mb-6 shadow-lg">
                <Zap className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-pink-400">
                Instalação rápida
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed mb-4">
                Em apenas 48 horas, o mercado está funcionando. Sem obras, sem
                adequações complexas.
              </p>
              <ul className="space-y-2">
                {[
                  "Apenas espaço de 2x2m necessário",
                  "Energia 110v/220v padrão",
                  "Instalação não invasiva",
                  "Funcionamento imediato",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-pink-500"></div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white mb-6 shadow-lg">
                <Shield className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-blue-400">
                Gestão completa
              </h3>
              <p className="text-gray-400 text-lg leading-relaxed mb-4">
                Cuidamos de absolutamente tudo: reposição, limpeza, manutenção
                e suporte.
              </p>
              <ul className="space-y-2">
                {[
                  "Reposição automática",
                  "Limpeza regular",
                  "Manutenção preventiva",
                  "Suporte 24/7",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Como <span className="text-purple-500">funciona</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Processo simples e rápido do contato à instalação
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              {
                step: "01",
                title: "Contato",
                description: "Entre em contato conosco",
              },
              {
                step: "02",
                title: "Visita técnica",
                description: "Avaliamos o melhor espaço",
              },
              {
                step: "03",
                title: "Instalação",
                description: "Montamos rapidamente",
              },
              {
                step: "04",
                title: "Pronto!",
                description: "Moradores já podem usar",
              },
            ].map((step, index) => (
              <div
                key={index}
                className="text-center p-6 rounded-xl bg-zinc-800 border border-zinc-700"
              >
                <div className="text-4xl font-bold text-purple-500/30 mb-3">
                  {step.step}
                </div>
                <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                <p className="text-gray-400 text-sm">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-gradient-to-br from-purple-500 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptMCAxMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6bS0xMiAwYzMuMzE0IDAgNiAyLjY4NiA2IDZzLTIuNjg2IDYtNiA2LTYtMi42ODYtNi02IDIuNjg2LTYgNi02em0xMi0xMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii4wNSIvPjwvZz48L3N2Zz4=')] opacity-30"></div>

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Building2 className="w-16 h-16 text-white/80 mx-auto mb-6" />
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Vamos valorizar seu condomínio?
          </h2>
          <p className="text-xl text-white/90 mb-12">
            Entre em contato e descubra como implementar o Agiliz.ai sem custos
            para o condomínio
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
           <a
  href="https://wa.me/5511947360963?text=Olá!%20Quero%20entender%20como%20posso%20instalar%20o%20Agiliz.ai%20na%20minha%20empresa%20ou%20condomínio.%20Pode%20me%20explicar%20os%20próximos%20passos??text=Olá!%20Quero%20entender%20como%20posso%20instalar%20o%20Agiliz.ai%20na%20minha%20empresa%20ou%20condomínio.%20Pode%20me%20explicar%20os%20próximos%20passos?"
  target="_blank"
  rel="noopener noreferrer"
  className="px-8 py-4 rounded-xl bg-white text-purple-600 font-semibold hover:shadow-2xl hover:shadow-white/30 transition-all duration-300 hover:scale-105"
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
