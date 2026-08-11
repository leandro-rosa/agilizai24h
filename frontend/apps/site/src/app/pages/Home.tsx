import { Link } from "react-router";
import {
  Store,
  Clock,
  CreditCard,
  Users,
  Zap,
  TrendingUp,
  Star,
  ArrowRight,
  ShoppingBag,
  Coffee,
  Package,
} from "lucide-react";
import heroImage from "@/assets/store-1.jpeg";
import storeImage from "@/assets/store-2.jpeg";

export function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={heroImage}
            alt="Agiliz.ai Store"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/90 via-zinc-950/80 to-zinc-950"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 text-center">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            Seu time não precisa
            <br />
            <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
              sair pra comer.
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-300 mb-12 max-w-3xl mx-auto">
            O Agiliz.ai instala um mercado autônomo 24h dentro da sua empresa ou
            condomínio — com comida de verdade, sem fila e sem operação.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/empresas"
              className="group px-8 py-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold hover:shadow-2xl hover:shadow-pink-500/50 transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
            >
              Quero na minha empresa
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/condominios"
              className="px-8 py-4 rounded-xl bg-white/10 backdrop-blur-lg text-white font-semibold hover:bg-white/20 transition-all duration-300 border border-white/20"
            >
              Quero no meu condomínio
            </Link>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-pink-500 flex items-start justify-center p-2">
            <div className="w-1 h-2 rounded-full bg-pink-500"></div>
          </div>
        </div>
      </section>

      {/* Segment Selection */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
            Onde você quer <span className="text-pink-500">implementar?</span>
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Empresas Card */}
            <Link
              to="/empresas"
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 p-8 border border-zinc-700 hover:border-pink-500/50 transition-all duration-300 hover:scale-105"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-pink-500/10 rounded-full blur-3xl group-hover:bg-pink-500/20 transition-all"></div>
              <Users className="w-16 h-16 text-pink-500 mb-6" />
              <h3 className="text-3xl font-bold mb-4">Empresas</h3>
              <p className="text-gray-400 text-lg mb-6">
                Aumente produtividade e ofereça um benefício real para o seu
                time
              </p>
              <div className="flex items-center gap-2 text-pink-500 font-semibold">
                Ver solução para empresas
                <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform" />
              </div>
            </Link>

            {/* Condomínios Card */}
            <Link
              to="/condominios"
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 p-8 border border-zinc-700 hover:border-purple-500/50 transition-all duration-300 hover:scale-105"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all"></div>
              <Store className="w-16 h-16 text-purple-500 mb-6" />
              <h3 className="text-3xl font-bold mb-4">Condomínios</h3>
              <p className="text-gray-400 text-lg mb-6">
                Mais praticidade, conveniência e valorização para moradores
              </p>
              <div className="flex items-center gap-2 text-purple-500 font-semibold">
                Ver solução para condomínios
                <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* What is Agiliz */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Conveniência 24h{" "}
                <span className="text-pink-500">sem operação</span>
              </h2>
              <p className="text-xl text-gray-300 mb-8 leading-relaxed">
                Um mini mercado autônomo instalado dentro do seu espaço.
                <br />
                <br />
                Sem funcionários, sem filas, sem complicação.
                <br />
                <br />
                <strong className="text-pink-500">
                  É só pegar, pagar e seguir o dia.
                </strong>
              </p>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-pink-500 to-purple-600 rounded-2xl blur-2xl opacity-20"></div>
              <img
                src={storeImage}
                alt="Agiliz.ai Store Interior"
                className="relative rounded-2xl shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Differential */}
      <section className="py-24 bg-gradient-to-b from-zinc-950 to-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Não é só um <span className="text-pink-500">mercadinho</span>
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Enquanto outros oferecem apenas produtos industrializados, o
              Agiliz.ai entrega <strong>comida de verdade</strong>.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: <Coffee className="w-8 h-8" />,
                title: "Marmitas prontas",
                description: "Refeições completas e saudáveis",
              },
              {
                icon: <Package className="w-8 h-8" />,
                title: "Panquecas e waffles",
                description: "Opções deliciosas para qualquer hora",
              },
              {
                icon: <ShoppingBag className="w-8 h-8" />,
                title: "Snacks e bebidas",
                description: "Variedade de opções refrescantes",
              },
              {
                icon: <Star className="w-8 h-8" />,
                title: "Itens essenciais",
                description: "Produtos do dia a dia sempre à mão",
              },
            ].map((item, index) => (
              <div
                key={index}
                className="p-6 rounded-xl bg-zinc-800 border border-zinc-700 hover:border-pink-500/50 transition-all duration-300 hover:scale-105"
              >
                <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white mb-4">
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-gray-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
            Como <span className="text-pink-500">funciona</span>
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                icon: <Store className="w-10 h-10" />,
                title: "Instalamos o mercado",
                description:
                  "Nossa equipe cuida de tudo: instalação, estoque inicial e configuração",
              },
              {
                step: "02",
                icon: <ShoppingBag className="w-10 h-10" />,
                title: "Usuários escolhem produtos",
                description:
                  "Acesso 24/7 para pegar o que precisar, quando precisar",
              },
              {
                step: "03",
                icon: <CreditCard className="w-10 h-10" />,
                title: "Pagamento automático",
                description:
                  "Pix, cartão ou app. Rápido, seguro e sem complicação",
              },
            ].map((item, index) => (
              <div key={index} className="relative">
                <div className="flex flex-col items-center text-center">
                  <div className="text-6xl font-bold text-pink-500/20 mb-4">
                    {item.step}
                  </div>
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white mb-6 shadow-lg shadow-pink-500/30">
                    {item.icon}
                  </div>
                  <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                  <p className="text-gray-400">{item.description}</p>
                </div>
                {index < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                    <ArrowRight className="w-8 h-8 text-pink-500/30" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-16">
            Por que escolher o <span className="text-pink-500">Agiliz.ai</span>
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <Clock className="w-8 h-8" />,
                title: "Funciona 24h",
                description: "Disponível sempre que você precisar",
              },
              {
                icon: <Zap className="w-8 h-8" />,
                title: "Zero custo de implantação",
                description: "Sem investimento inicial para você",
              },
              {
                icon: <Users className="w-8 h-8" />,
                title: "Sem operação",
                description: "Não precisa gerenciar nada",
              },
              {
                icon: <Star className="w-8 h-8" />,
                title: "Aumenta satisfação",
                description: "Benefício real para seu time ou moradores",
              },
              {
                icon: <TrendingUp className="w-8 h-8" />,
                title: "Diferencial competitivo",
                description: "Destaque-se no mercado",
              },
              {
                icon: <Package className="w-8 h-8" />,
                title: "Comida de verdade",
                description: "Não é só snack, é refeição completa",
              },
            ].map((benefit, index) => (
              <div
                key={index}
                className="p-6 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 hover:border-pink-500/50 transition-all duration-300"
              >
                <div className="w-14 h-14 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 mb-4">
                  {benefit.icon}
                </div>
                <h3 className="text-xl font-bold mb-2">{benefit.title}</h3>
                <p className="text-gray-400">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-4">
            Na prática, já{" "}
            <span className="text-pink-500">funciona assim</span>
          </h2>
          <p className="text-xl text-gray-400 text-center mb-16">
            Comida de verdade, sem perder tempo.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="relative group overflow-hidden rounded-2xl">
              <img
                src={heroImage}
                alt="Agiliz.ai Installation"
                className="w-full h-96 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent opacity-60 group-hover:opacity-80 transition-opacity"></div>
            </div>
            <div className="relative group overflow-hidden rounded-2xl">
              <img
                src={storeImage}
                alt="Agiliz.ai Store"
                className="w-full h-96 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent opacity-60 group-hover:opacity-80 transition-opacity"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-gradient-to-br from-pink-500 to-purple-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptMCAxMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6bS0xMiAwYzMuMzE0IDAgNiAyLjY4NiA2IDZzLTIuNjg2IDYtNiA2LTYtMi42ODYtNi02IDIuNjg2LTYgNi02em0xMi0xMmMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptLTEyIDBjMy4zMTQgMCA2IDIuNjg2IDYgNnMtMi42ODYgNi02IDYtNi0yLjY4Ni02LTYgMi42ODYtNiA2LTZ6IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii4wNSIvPjwvZz48L3N2Zz4=')] opacity-30"></div>

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Vamos implementar no seu espaço?
          </h2>
          <p className="text-xl text-white/90 mb-12">
            Entre em contato e descubra como o Agiliz.ai pode transformar a
            experiência de conveniência no seu ambiente.
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
              Solicitar proposta
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
