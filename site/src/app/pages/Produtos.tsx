import { Coffee, Package, Droplet, Star, ShoppingBag } from "lucide-react";

export function Produtos() {
  const categories = [
    {
      icon: <Coffee className="w-12 h-12" />,
      title: "Refeições Prontas",
      color: "pink",
      products: [
        { name: "Marmitas Fit", description: "Opções balanceadas e saudáveis" },
        { name: "Marmitas Tradicionais", description: "Almoço completo" },
        { name: "Opções Vegetarianas", description: "100% plant-based" },
        { name: "Low Carb", description: "Refeições com baixo carboidrato" },
        { name: "Massas", description: "Diversas opções de massas" },
        { name: "Pratos Executivos", description: "Refeições completas" },
      ],
    },
    {
      icon: <Package className="w-12 h-12" />,
      title: "Lanches",
      color: "purple",
      products: [
        { name: "Panquecas", description: "Doces e salgadas" },
        { name: "Waffles", description: "Diversos sabores" },
        { name: "Sanduíches Naturais", description: "Opções leves" },
        { name: "Wraps", description: "Práticos e saborosos" },
        { name: "Saladas", description: "Frescas e crocantes" },
        { name: "Snacks Saudáveis", description: "Nuts, frutas secas" },
      ],
    },
    {
      icon: <Droplet className="w-12 h-12" />,
      title: "Bebidas",
      color: "pink",
      products: [
        { name: "Sucos Naturais", description: "100% fruta" },
        { name: "Água Mineral", description: "Com e sem gás" },
        { name: "Refrigerantes", description: "Diversas marcas" },
        { name: "Energéticos", description: "Para dar energia" },
        { name: "Bebidas Lácteas", description: "Iogurtes e vitaminas" },
        { name: "Café", description: "Diversas opções" },
      ],
    },
    {
      icon: <Star className="w-12 h-12" />,
      title: "Essenciais",
      color: "purple",
      products: [
        { name: "Higiene Pessoal", description: "Itens básicos" },
        { name: "Medicamentos Básicos", description: "Primeiros socorros" },
        { name: "Produtos de Limpeza", description: "Essenciais do lar" },
        { name: "Doces e Chocolates", description: "Para qualquer hora" },
        { name: "Salgadinhos", description: "Diversos sabores" },
        { name: "Sobremesas", description: "Doces variados" },
      ],
    },
  ];

  return (
    <div className="min-h-screen pt-20">
      {/* Hero Section */}
      <section className="py-24 bg-gradient-to-b from-zinc-950 to-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-block px-4 py-2 rounded-full bg-pink-500/20 border border-pink-500/30 text-pink-400 text-sm font-semibold mb-6">
            Nossos Produtos
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            Muito mais que{" "}
            <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
              snacks
            </span>
          </h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto mb-12">
            Do café da manhã ao jantar, passando por lanches e essenciais do dia
            a dia. Tudo o que você precisa, disponível 24/7.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { icon: <ShoppingBag />, text: "200+ produtos" },
              { icon: <Star />, text: "Qualidade garantida" },
              { icon: <Coffee />, text: "Comida de verdade" },
              { icon: <Package />, text: "Sempre fresco" },
            ].map((item, index) => (
              <div
                key={index}
                className="p-4 rounded-xl bg-zinc-800 border border-zinc-700"
              >
                <div className="text-pink-500 mb-2 flex justify-center">
                  {item.icon}
                </div>
                <p className="text-sm text-gray-400">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-16">
            {categories.map((category, categoryIndex) => (
              <div key={categoryIndex}>
                <div className="flex items-center gap-4 mb-8">
                  <div
                    className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${
                      category.color === "pink"
                        ? "from-pink-500 to-pink-600"
                        : "from-purple-500 to-purple-600"
                    } flex items-center justify-center text-white shadow-lg`}
                  >
                    {category.icon}
                  </div>
                  <div>
                    <h2 className="text-3xl md:text-4xl font-bold">
                      {category.title}
                    </h2>
                    <div className="h-1 w-32 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full mt-2"></div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {category.products.map((product, productIndex) => (
                    <div
                      key={productIndex}
                      className="group p-6 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 hover:border-pink-500/50 transition-all duration-300 hover:scale-105"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-xl font-bold">{product.name}</h3>
                        <div
                          className={`w-2 h-2 rounded-full ${
                            category.color === "pink"
                              ? "bg-pink-500"
                              : "bg-purple-500"
                          }`}
                        ></div>
                      </div>
                      <p className="text-gray-400">{product.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Quality Section */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Nosso <span className="text-pink-500">compromisso</span>
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Qualidade e frescor em cada produto
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <Star className="w-10 h-10" />,
                title: "Produtos Selecionados",
                description:
                  "Trabalhamos apenas com fornecedores certificados e produtos de alta qualidade",
              },
              {
                icon: <Package className="w-10 h-10" />,
                title: "Reposição ágil",
                description:
                  "Produtos frescos repostos sempre para garantir a melhor experiência",
              },
              {
                icon: <Coffee className="w-10 h-10" />,
                title: "Variedade Constante",
                description:
                  "Sempre atualizando nosso mix com novidades e produtos da estação",
              },
            ].map((item, index) => (
              <div
                key={index}
                className="p-8 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700 text-center"
              >
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white mx-auto mb-6 shadow-lg shadow-pink-500/30">
                  {item.icon}
                </div>
                <h3 className="text-2xl font-bold mb-4">{item.title}</h3>
                <p className="text-gray-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-br from-pink-500 to-purple-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            Quer saber mais sobre nossos produtos?
          </h2>
          <p className="text-xl text-white/90 mb-12">
            Entre em contato e descubra todas as opções disponíveis
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
          </div>
        </div>
      </section>
    </div>
  );
}
