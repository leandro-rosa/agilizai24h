import { useState } from "react";
import { Mail, Phone, MapPin, Send, MessageSquare } from "lucide-react";

export function Contato() {
  const [formData, setFormData] = useState({
    nome: "",
    telefone: "",
    tipo: "",
    mensagem: "",
  });

 const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();

  const name = formData?.nome?.trim() || '';
  const phone = formData?.telefone?.trim() || '';
  const locationType = formData?.tipo?.trim() || '';
  const messageText = formData?.mensagem?.trim() || '';

  const message = [
    'Olá! Quero entender como posso instalar o Agiliz.ai no meu espaço.',
    '',
    `Nome: ${name}`,
    `Telefone: ${phone}`,
    `Tipo de local: ${locationType}`,
    `Mensagem: ${messageText || 'Não informada'}`,
  ].join('\n');

  const whatsappNumber = '5511947360963';
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  window.open(whatsappUrl, '_blank');
};

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen pt-20">
      {/* Hero Section */}
      <section className="py-24 bg-gradient-to-b from-zinc-950 to-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-block px-4 py-2 rounded-full bg-pink-500/20 border border-pink-500/30 text-pink-400 text-sm font-semibold mb-6">
            Entre em contato
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            Vamos{" "}
            <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
              conversar?
            </span>
          </h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Estamos prontos para implementar o Agiliz.ai no seu espaço. Entre em
            contato e descubra como.
          </p>
        </div>
      </section>

      <section className="py-24 bg-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Contact Info */}
            <div>
              <h2 className="text-3xl md:text-4xl font-bold mb-8">
                Fale <span className="text-pink-500">conosco</span>
              </h2>
              <p className="text-lg text-gray-300 mb-12 leading-relaxed">
                Preencha o formulário ou use um dos canais abaixo. Nossa equipe
                está pronta para responder suas dúvidas e criar uma proposta
                personalizada.
              </p>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                    <Phone className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Telefone</h3>
                    <p className="text-gray-400">+55 (11) 94736-0963</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                    <Mail className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Email</h3>
                    <p className="text-gray-400">barbara@agilizai24h.com</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">
                      Localização
                    </h3>
                    <p className="text-gray-400">
                      São Paulo, SP
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-12 p-6 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600">
                <div className="flex items-center gap-3 mb-4">
                  <MessageSquare className="w-6 h-6 text-white" />
                  <h3 className="text-xl font-bold text-white">
                    Prefere falar por WhatsApp?
                  </h3>
                </div>
                <p className="text-white/90 mb-6">
                  Converse diretamente com nossa equipe agora mesmo
                </p>
                <a
                  href="https://wa.me/5511947360963?text=Olá!%20Quero%20entender%20como%20posso%20instalar%20o%20Agiliz.ai%20na%20minha%20empresa%20ou%20condomínio.%20Pode%20me%20explicar%20os%20próximos%20passos?"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-6 py-3 rounded-xl bg-white text-pink-600 font-semibold hover:shadow-lg hover:shadow-white/30 transition-all duration-300 hover:scale-105"
                >
                  Abrir WhatsApp
                </a>
              </div>
            </div>

            {/* Contact Form */}
            <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl p-8 border border-zinc-700">
              <h3 className="text-2xl font-bold mb-6">Solicitar Proposta</h3>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label
                    htmlFor="nome"
                    className="block text-sm font-semibold text-gray-300 mb-2"
                  >
                    Nome completo
                  </label>
                  <input
                    type="text"
                    id="nome"
                    name="nome"
                    value={formData.nome}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-700 text-white focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all"
                    placeholder="Seu nome"
                  />
                </div>

                <div>
                  <label
                    htmlFor="telefone"
                    className="block text-sm font-semibold text-gray-300 mb-2"
                  >
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="tel"
                    id="telefone"
                    name="telefone"
                    value={formData.telefone}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-700 text-white focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div>
                  <label
                    htmlFor="tipo"
                    className="block text-sm font-semibold text-gray-300 mb-2"
                  >
                    Tipo de implementação
                  </label>
                  <select
                    id="tipo"
                    name="tipo"
                    value={formData.tipo}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-700 text-white focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all"
                  >
                    <option value="">Selecione uma opção</option>
                    <option value="empresa">Empresa</option>
                    <option value="condominio">Condomínio</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="mensagem"
                    className="block text-sm font-semibold text-gray-300 mb-2"
                  >
                    Mensagem
                  </label>
                  <textarea
                    id="mensagem"
                    name="mensagem"
                    value={formData.mensagem}
                    onChange={handleChange}
                    rows={5}
                    className="w-full px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-700 text-white focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/20 transition-all resize-none"
                    placeholder="Conte-nos mais sobre suas necessidades..."
                  ></textarea>
                </div>

                <button
                  type="submit"
                  className="w-full px-6 py-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-semibold hover:shadow-2xl hover:shadow-pink-500/50 transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
                >
                  Enviar mensagem
                  <Send className="w-5 h-5" />
                </button>

                <p className="text-sm text-gray-400 text-center">
                  Responderemos em até 24 horas úteis
                </p>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Preview */}
      <section className="py-24 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Perguntas <span className="text-pink-500">Frequentes</span>
            </h2>
            <p className="text-gray-400">
              Respostas rápidas para dúvidas comuns
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {[
              {
                question: "Quanto custa a implementação?",
                answer:
                  "Zero custo de implementação. Cuidamos de tudo: instalação, equipamentos e produtos.",
              },
              {
                question: "Qual espaço necessário?",
                answer:
                  "Apenas 2x2m de espaço e alguns pontos de energia. Instalamos sem obras ou adequações complexas.",
              },
              {
                question: "Como funciona a reposição?",
                answer:
                  "Nossa equipe faz reposição automática conforme o consumo, sem você precisar se preocupar.",
              },
              {
                question: "Quais formas de pagamento?",
                answer:
                  "Pix, cartão de crédito/débito e app próprio. Pagamento 100% automático e seguro.",
              },
            ].map((faq, index) => (
              <div
                key={index}
                className="p-6 rounded-xl bg-zinc-800 border border-zinc-700"
              >
                <h3 className="font-bold text-lg mb-2 text-pink-400">
                  {faq.question}
                </h3>
                <p className="text-gray-400">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
